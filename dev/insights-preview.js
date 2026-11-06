import * as PIXI from "/dev/pixi.mjs";
import { registerSettings } from "../scripts/settings.js";
import { RollInsights, formatRollNumber } from "../scripts/roll-insights.js";
import { rollStatistics } from "../scripts/roll-statistics.js";
import { DistanceOverlay } from "../scripts/distance.js";
import { withToolsForecast, toolsForecast, toolsTargetDefense } from "../scripts/tools-forecast.js";
import { installToolsDialogOverride } from "../scripts/tools-dialogs.js";
import { SWADE_TOOLS_GLOBAL_SETTING } from "../scripts/swade.js";
const settings=new Map(), definitions=new Map(), hooks=new Map();
const features=["tokenDistance","damageEstimate","successRates","chatRollRange"];
globalThis.Hooks={on:(key,fn)=>{const entries=hooks.get(key)??[];entries.push(fn);hooks.set(key,entries);return fn;},off:(key,fn)=>hooks.set(key,(hooks.get(key)??[]).filter(entry=>entry!==fn)),callAll:(key,...args)=>{for(const fn of [...hooks.get(key)??[]])fn(...args);}};
const trait = {die:{sides:8,modifier:0},"wild-die":{sides:6},effects:[]};
const skill={id:"fight",name:"Fighting",type:"skill",system:{...trait,attribute:"agility"}};
const item={id:"spear",name:"Spear",type:"weapon",system:{isMelee:true,isRanged:false,damage:"@str+d6",minStr:"d6",trademark:0,rof:1,actions:{trait:"Fighting",traitMod:0,dmgMod:0,additional:{empowered:{name:"Empowered",type:"damage",override:"3d6",modifier:0}}},bonusDamageDie:6},effects:[],getFlag:()=>null};
const items=[skill,item];items.get=id=>items.find(item=>item.id===id);
const actor={id:"pc",uuid:"Actor.pc",name:"Player Character",isOwner:true,isWildcard:true,items,
 system:{attributes:Object.fromEntries(["agility","smarts","spirit","strength","vigor"].map(key=>[key,structuredClone(trait)])),status:{},wounds:{value:0,ignored:0},fatigue:{value:0,ignored:0},woundsOrFatigue:{ignored:0},details:{conviction:{active:false}},stats:{globalMods:Object.fromEntries(["trait","agility","smarts","spirit","strength","vigor","attack","damage"].map(key=>[key,[]]))}},getRollData:()=>({str:"1d8"})};
globalThis.game={user:{id:"gm",isGM:true,targets:new Set()},combat:null,actors:[actor],modules:new Map([["swade-hud",{api:{actor}}],["swade-tools",{active:true}]]),i18n:{localize:key=>({"SWADE.AttrAgi":"Agility","SWADE.AttrStr":"Strength"})[key]??key},settings:{
 register:(namespace,key,config)=>{definitions.set(key,config);settings.set(key,config.default);},
 get:(namespace,key)=>namespace==="swade-hud"?settings.get(key):key.endsWith("Setting")?key.slice(0,-7):key==="shootingSkill"?"Shooting":false,
}};
registerSettings();
globalThis.PIXI=PIXI;
const pixi=new PIXI.Application({view:document.querySelector("#board"),width:innerWidth,height:innerHeight,backgroundAlpha:0,antialias:true});
const source={actor,center:{x:70,y:innerHeight-55},x:35,y:innerHeight-90,w:70,h:70,visible:true,document:{}};
const target={id:"foe",name:"Target",actor:{name:"Target",items:[],system:{stats:{parry:{value:7},globalMods:{}}}},center:{x:420,y:innerHeight-55},x:385,y:innerHeight-90,w:70,h:70,visible:true,document:{uuid:"Scene.fixture.Token.foe",hidden:false}};
const middle={center:{x:245,y:innerHeight-55},x:210,y:innerHeight-90};
globalThis.canvas={ready:true,stage:pixi.stage,app:pixi,scene:{grid:{units:"ft."}},grid:{size:70,measurePath:([a,b])=>({distance:Math.hypot(b.x-a.x,b.y-a.y)/70*5})}};
for(const [token,name,color] of [[source,"Your token",0x426c36],[middle,"Intervening token",0x354b6d],[target,"Target",0x6d3b35]]){
 const square=new PIXI.Graphics().lineStyle(2,0xc6bea5).beginFill(color).drawRect(token.x,token.y,70,70).endFill();pixi.stage.addChild(square);
 const label=new PIXI.Text(name,{fontSize:12,fill:0xf0eee6,fontFamily:"Signika"});label.anchor.set(.5,0);label.position.set(token.center.x,token.y+74);pixi.stage.addChild(label);
}
const distance=new DistanceOverlay(()=>source,()=>settings.get("tokenDistance"));
const insights=new RollInsights();insights.start();
game.modules.get("swade-hud").api.refreshFeatures=()=>{distance.refresh();insights.refresh();};
for(const feature of features){
 const label=document.createElement("label"),box=document.createElement("input");box.type="checkbox";box.checked=true;box.id=feature;
 box.onchange=()=>{settings.set(feature,box.checked);game.modules.get("swade-hud").api.refreshFeatures();};label.append(box,document.createTextNode(({tokenDistance:'Token distance',damageEstimate:'Damage estimates',successRates:'Success rates',chatRollRange:'Chat roll range'})[feature]));document.querySelector("#feature-settings").append(label);
}
const hover=document.querySelector("#target-hitbox");hover.onpointerenter=()=>distance.hover(target,true);hover.onpointerleave=()=>distance.hover(target,false);
document.querySelector("#show-distance").onclick=()=>distance.hover(target,true);
document.querySelector("#player-view").onclick=(event)=>{
 game.user.isGM=!game.user.isGM;event.target.textContent=game.user.isGM?'Switch to player view':'Switch to GM view';insights.refreshDialogs();
};
document.querySelector("#select-target").onclick=(event)=>{
 const active=!game.user.targets.has(target);if(active)game.user.targets.add(target);else game.user.targets.delete(target);
 event.target.textContent=active?'Untarget defender':'Target defender';Hooks.callAll('targetToken',game.user,target,active);
};
const message={id:"sample",rolls:[{formula:"{1d8x,1dw6}kh",total:5}],isContentVisible:true,visible:true};
insights.chat(message,document.querySelector("#chat-sample"));
const dialogs=[];
async function nativeDialog(damage){
 const root=document.createElement("form");root.className="application swade roll-dialog swade-application standard-form feature-dialog";
 root.innerHTML='<header class="window-header"><h1 class="window-title">'+(damage?'Damage Roll':'Fighting Skill Test')+'</h1></header><section class="window-content"></section>';
 root.querySelector(".window-content").innerHTML=await(await fetch('/dev/native-roll-dialog?damage='+(damage?1:0))).text();
 const footer=document.createElement("footer");footer.className="form-footer";footer.innerHTML='<button type="button">Roll</button><button type="button">Close</button>';root.querySelector(".window-content").append(footer);
 document.body.append(root);
 const formula=damage?'1d8x+1d6x':'{1d8x,1dw6}kh';
 const app={element:root,isDamageRoll:damage,isTraitRoll:!damage,ctx:{actor,item,mods:[],roll:{formula,options:{rollType:damage?'damage':'trait'}}}};
 footer.lastElementChild.onclick=()=>{root.remove();insights.forgetDialog(app);};
 root.querySelector('[data-index="0"]').addEventListener('change',event=>{root.querySelector('.formula textarea').value=formula+(event.target.checked?'+2':'');Hooks.callAll('renderApplicationV2',app,root);});
 Hooks.callAll('renderApplicationV2',app,root);dialogs.push(app);return app;
}
async function openDialogs(){for(const dialog of dialogs.splice(0)){dialog.element.remove();insights.forgetDialog(dialog);}await nativeDialog(false);await nativeDialog(true);}
document.querySelector("#open-dialogs").onclick=openDialogs;
async function toolsDialog(){
 const root=document.createElement("div");root.className="application feature-dialog";root.style.left="280px";root.style.height="240px";
 root.innerHTML='<header class="window-header"><h1 class="window-title">Spear · SWADE Tools</h1></header><section class="window-content"><div class="dialog-content"><div class="swadetools-dialog-item"><div class="swadetools-itemfulldata">Spear</div><label>Modifier<input id="mod" value="0"></label><label>Damage raise<input id="raise" type="checkbox"></label></div></div><footer class="dialog-buttons"><button type="button" class="dialog-button" data-button="mainSkill">Attack</button><button type="button" class="dialog-button" data-button="mainDamage">Damage</button><button type="button" class="dialog-button" data-button="empowered">Empowered</button></footer></section>';
 const app={title:item.name,element:root,position:{height:240,scale:1},setPosition(position){
  for(const [key,value] of Object.entries(position)){
   if(key==='height'&&value==='auto'){root.style.height='';this.position.height=root.offsetHeight+1;root.style.height=this.position.height+'px';}
   else {this.position[key]=value;root.style[key]=value+'px';}
  }
 }};
 withToolsForecast({actor,item},()=>{});document.body.append(root);app.originalHeight=root.getBoundingClientRect().height;Hooks.callAll("renderDialog",app,root);dialogs.push(app);return app;
}
document.querySelector("#tools-dialog").onclick=toolsDialog;
const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
document.querySelector("#run-checks").onclick=async()=>{
 const output=document.querySelector("#checks-result"),results=[];
 const check=(name,condition)=>{if(!condition)throw Error(name);results.push('PASS '+name);output.textContent=results.join('\n');};
 try{
  await toolsTargetDefense(target.actor,'melee'); // Wait for first-load module imports before frame-based checks.
  await openDialogs();await tick();const [trait,damage]=dialogs;
  check('Four independent settings default on',features.every(key=>settings.get(key)));
  check('Four probability categories; all raises combined',trait.element.querySelectorAll('.success-bar .outcome').length===4&&!trait.element.textContent.includes('2nd Raise'));
  check('Snake eyes shown separately',trait.element.querySelector('.outcome-label').textContent.includes('2.1%'));
  check('Acing damage includes raise option without Max',damage.element.querySelectorAll('.damage-estimate').length===2&&!damage.element.querySelector('.estimate-values').textContent.includes('Max'));
  const before=damage.element.querySelector('.estimate-values').textContent;
  damage.element.querySelector('[name=noAcing]').checked=true;damage.element.querySelector('[name=noAcing]').dispatchEvent(new Event('change',{bubbles:true}));await tick();
  check('No Acing updates the finite maximum',damage.element.querySelector('.estimate-values').textContent.includes('Max 14'));
  damage.element.querySelector('.new-modifier-value').value='3';damage.element.querySelector('.new-modifier-value').dispatchEvent(new Event('input',{bubbles:true}));await tick();
  check('Pending modifier updates damage immediately',damage.element.querySelector('.estimate-values').textContent.includes('Max 17'));
  check('Damage values round down',damage.element.querySelectorAll('.estimate-values')[1].textContent.includes('Avg 14'));
  damage.element.querySelector('[name=noAcing]').checked=false;damage.element.querySelector('[name=noAcing]').dispatchEvent(new Event('change',{bubbles:true}));await tick();
  check('Max disappears when No Acing is cleared',![...damage.element.querySelectorAll('.estimate-values')].some(el=>el.textContent.includes('Max')));
  const tn=trait.element.querySelector('.success-target');tn.value='8';tn.dispatchEvent(new Event('change',{bubbles:true}));await tick();
  trait.element.querySelector('[data-index="0"]').checked=true;trait.element.querySelector('[data-index="0"]').dispatchEvent(new Event('change',{bubbles:true}));await tick();
  check('Target number survives native dialog re-render',trait.element.querySelector('.success-target').value==='8');
  game.user.targets.add(target);Hooks.callAll('targetToken',game.user,target,true);await tick();
  check('Selected target uses its prepared Parry',trait.element.querySelector('.success-target').value==='7'&&trait.element.querySelector('.success-heading').textContent.includes('Target · Parry'));
  target.actor.system.stats.parry.value=9;Hooks.callAll('updateActor',target.actor);await tick();
  check('Open dialog updates when target defense changes',trait.element.querySelector('.success-target').value==='9');
  item.system.isMelee=false;item.system.isRanged=true;item.system.actions.trait='Shooting';
  target.actor.items.push({type:'edge',name:'Dodge',system:{}});Hooks.callAll('updateItem',item);await tick();
  check('Tools Dodge defense raises ranged TN to 6',trait.element.querySelector('.success-target').value==='6'&&trait.element.textContent.includes('Dodge -2'));
  target.actor.system.stats.globalMods.targetAttackRanged=[{label:'Dodge',value:-2}];Hooks.callAll('updateActor',target.actor);await tick();
  check('Prepared Dodge and Tools edge are counted once',trait.element.querySelector('.success-target').value==='6');
  const gmOdds=trait.element.querySelector('.success-bar').getAttribute('aria-label');
  game.user.isGM=false;insights.refreshDialogs();await tick();
  const playerPanel=trait.element.querySelector('.swade-hud-roll-insights');
  check('Player native preview omits enemy TN and defense details entirely',!playerPanel.querySelector('.success-target,[title*="target number"],[aria-label*="target number"]')&&!/\bTN\b|Parry|Dodge|Ranged/.test(playerPanel.textContent));
  check('Player hit probabilities still use the actual enemy defense',playerPanel.querySelector('.success-bar').getAttribute('aria-label')===gmOdds);
  target.actor.isOwner=true;insights.refreshDialogs();await tick();
  check('Players retain the TN preview for actors they own',trait.element.querySelector('.success-target')?.value==='6');
  target.actor.isOwner=false;game.user.isGM=true;insights.refreshDialogs();await tick();
  check('GM preview retains target TN and defense details',trait.element.querySelector('.success-target')?.value==='6'&&trait.element.textContent.includes('Dodge -2'));
  game.user.targets.clear();Hooks.callAll('targetToken',game.user,target,false);item.system.isMelee=true;item.system.isRanged=false;item.system.actions.trait='Fighting';target.actor.items=[];target.actor.system.stats.globalMods={};await tick();
  check('Range inserted before dice formula',document.querySelector('#chat-sample .dice-formula').previousElementSibling.classList.contains('swade-hud-roll-range'));
  const scale=document.querySelector('#chat-sample .swade-hud-roll-range');
  check('Chat scale has Min and Average, no Max, tooltip or marker',scale.textContent.includes('Min 1')&&scale.textContent.includes('Average 6')&&!scale.textContent.includes('Max')&&!scale.hasAttribute('title')&&!scale.querySelector('.range-marker'));
  check('Chat scale values floor their actual averages',formatRollNumber(rollStatistics(message.rolls[0].formula).average)===scale.querySelector('.range-labels').lastElementChild.textContent.replace('Average ',''));
  insights.chat(message,document.querySelector('#chat-sample'));await tick();check('Chat rendering is idempotent',document.querySelectorAll('#chat-sample .swade-hud-roll-range').length===1);
  document.querySelector('#chat-sample .dice-result').innerHTML='<div class="dice-formula">2 &nbsp; 5</div><div class="dice-total">5</div>';await tick();
  check('Range survives asynchronous Tools-style card replacement',document.querySelector('#chat-sample .dice-formula').previousElementSibling.classList.contains('swade-hud-roll-range'));
  message.isContentVisible=false;insights.chat(message,document.querySelector('#chat-sample'));await tick();check('Private roll statistics stay hidden',!document.querySelector('#chat-sample .swade-hud-roll-range'));
  message.isContentVisible=true;insights.chat(message,document.querySelector('#chat-sample'));
  for(const feature of ['damageEstimate','successRates','chatRollRange']){
   settings.set(feature,false);insights.refresh();await tick();
   check(feature+' switches off independently',feature==='damageEstimate'?!damage.element.querySelector('.damage-estimate'):feature==='successRates'?!trait.element.querySelector('.success-bar'):!document.querySelector('.swade-hud-roll-range'));
   settings.set(feature,true);insights.refresh();await tick();
  }
  distance.reset();distance.hover(target,true);await new Promise(resolve=>setTimeout(resolve,150));check('Distance stays hidden before 0.3-second hover delay',!distance.container);
  await new Promise(resolve=>setTimeout(resolve,200));check('Real PIXI overlay appears after 0.3-second hover delay',Boolean(distance.container)&&distance.label.text.includes('ft.'));
  check('Line lies below endpoint art and above intervening token',distance.segments[0][0]>.09&&distance.segments[0][1]<.91&&distance.segments[0][0]<.5&&distance.segments[0][1]>.5&&pixi.stage.children.at(-1)===distance.container);
  target.center.x+=70;distance.refresh();check('Overlay follows moving token centers',distance.label.x===target.center.x);target.center.x-=70;
  pixi.stage.scale.set(2);distance.refresh();check('Distance text and line preserve screen size while zooming',distance.label.scale.x===.5&&distance.line.geometry.graphicsData.some(data=>data.lineStyle.width===1));pixi.stage.scale.set(1);distance.refresh();
  const oldX=target.x,oldCenter=target.center.x;target.x=105;target.center.x=140;distance.refresh();check('Adjacent token hides line and label but keeps movement watcher',!distance.container&&distance.ticker===pixi.ticker);target.x=oldX;target.center.x=oldCenter;distance.refresh();check('Moving apart while still hovered restores the overlay',Boolean(distance.container));
  distance.hover(target,false);distance.hover(target,true);await new Promise(resolve=>setTimeout(resolve,100));distance.hover(target,false);await new Promise(resolve=>setTimeout(resolve,250));check('Hover-out cancels a pending distance line',!distance.container);distance.hover(target,true);await new Promise(resolve=>setTimeout(resolve,350));
  settings.set('tokenDistance',false);distance.refresh();check('Distance toggles off immediately',!distance.container);settings.set('tokenDistance',true);distance.refresh();
  target.document.hidden=true;game.user.isGM=false;distance.refresh();check('Hidden targets do not leak distance',!distance.container);target.document.hidden=false;game.user.isGM=true;distance.refresh();
  const tools=await toolsDialog();await new Promise(resolve=>setTimeout(resolve,300));
  await toolsForecast({actor,item},tools.element);
  await toolsForecast({actor,item},tools.element,true);
  check('Actual Tools modifier collectors produce both forecasts',tools.element.querySelector('.damage-estimate')&&tools.element.querySelector('.success-bar'));
  check('Tools estimates appear below the action buttons',tools.element.querySelector('.dialog-buttons').nextElementSibling===tools.element.querySelector('.swade-hud-roll-insights'));
  const bottomSpace=()=>tools.element.querySelector('.window-content').getBoundingClientRect().bottom-tools.element.querySelector('.swade-hud-roll-insights').getBoundingClientRect().bottom;
  check('Tools dialog fits its content without a blank bottom area',bottomSpace()<24);
  check('Native dialog estimates stay above the roll buttons',trait.element.querySelector('.swade-hud-roll-insights').nextElementSibling===trait.element.querySelector('.form-footer'));
  const toolsHeight=tools.element.getBoundingClientRect().height;
  tools.element.querySelector('#mod').value='2';tools.element.querySelector('#mod').dispatchEvent(new Event('input',{bubbles:true}));await tick();
  check('Tools modifier changes update estimates live',tools.element.querySelector('.estimate-values').textContent.includes('Min 4'));
  check('Updating Tools estimates retains a compact height',Math.abs(tools.element.getBoundingClientRect().height-toolsHeight)<2&&bottomSpace()<24);
  Hooks.callAll('renderDialog',tools,tools.element);await tick();
  check('Tools dialog rerenders retain a compact height',Math.abs(tools.element.getBoundingClientRect().height-toolsHeight)<2&&bottomSpace()<24);
  settings.set('damageEstimate',false);settings.set('successRates',false);insights.refreshDialogs();await tick();
  check('Disabling both estimates shrinks the Tools dialog to its remaining content',!tools.element.classList.contains('swade-hud-tools-insights')&&tools.element.getBoundingClientRect().height<toolsHeight);
  settings.set('damageEstimate',true);settings.set('successRates',true);insights.refreshDialogs();await tick();
  check('Reenabling estimates fits Tools to the content again',Math.abs(tools.element.getBoundingClientRect().height-toolsHeight)<2&&bottomSpace()<24);
  const longContent=document.createElement('div');longContent.style.height='1600px';tools.element.querySelector('.dialog-content').append(longContent);insights.refreshDialogs();await tick();
  check('Long Tools dialogs stay inside the viewport and scroll',tools.element.getBoundingClientRect().height<=innerHeight-16&&tools.element.querySelector('.window-content').scrollHeight>tools.element.querySelector('.window-content').clientHeight);
  longContent.remove();insights.refreshDialogs();await tick();
  check('Removing long content shrinks the Tools dialog again',bottomSpace()<24&&Math.abs(tools.element.getBoundingClientRect().height-toolsHeight)<2);
  tools.element.querySelector('[data-button=empowered]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));await tick();
  check('Tools action hover previews the actual damage variant',tools.element.querySelector('.damage-estimate').textContent.includes('Empowered')&&tools.element.querySelector('.estimate-values').textContent.includes('Min 5'));
  game.user.targets.add(target);game.user.isGM=false;insights.refreshDialogs();await tick();
  check('Player Tools preview hides enemy TN and Parry while retaining odds',!tools.element.querySelector('.success-target')&&tools.element.querySelector('.success-heading')?.textContent==='Target'&&!!tools.element.querySelector('.success-bar'));
  game.user.targets.clear();game.user.isGM=true;insights.refreshDialogs();await tick();
  tools.element.remove();insights.forgetDialog(tools);dialogs.pop();
  const nativeCalls=[];
  actor.rollAttribute=async(attribute,options)=>{nativeCalls.push(['attribute',attribute,options]);return nativeDialog(false);};
  actor.rollSkill=async(id,options)=>{nativeCalls.push(['skill',id,options]);return nativeDialog(false);};
  actor.rollRunningDie=async()=>{nativeCalls.push(['run']);};
  game.swade={itemChatCardHelper:{handleAction:async(item,roller,action)=>{nativeCalls.push(['item',item.id,action,roller]);return nativeDialog(action==='damage');}}};
  await installToolsDialogOverride();
  const [{default:SystemRoll},{default:ItemDialog}]=await Promise.all([import('/modules/swade-tools/scripts/class/SystemRoll.js'),import('/modules/swade-tools/scripts/class/ItemDialog.js')]);
  settings.set(SWADE_TOOLS_GLOBAL_SETTING,true);
  await new SystemRoll(actor).rollAtt('agility');await new SystemRoll(actor).rollSkill(skill.id);await new SystemRoll(actor).rollRun();
  await new ItemDialog(actor,item.id).showDialog();await new SystemRoll(actor).rollDamage(item.id);await tick();
  check('Real Tools trait, item, running and damage entry points obey the global override',nativeCalls.map(call=>call[0]).join(',')==='attribute,skill,run,item,item'&&nativeCalls[3][2]==='formula'&&nativeCalls[4][2]==='damage');
  check('Globally redirected rolls use native SWADE templates with estimates',dialogs.at(-1).element.querySelector('.formula textarea')&&dialogs.at(-1).element.querySelector('.damage-estimate'));
  settings.set(SWADE_TOOLS_GLOBAL_SETTING,false);
  output.textContent=results.join('\n')+'\n'+results.length+' checks passed';
 }catch(error){output.textContent=results.join('\n')+'\nFAIL '+error.message;console.error(error);}
};
await openDialogs();
