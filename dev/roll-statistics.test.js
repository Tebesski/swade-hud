import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFormula, rollStatistics, rangePosition } from "../scripts/roll-statistics.js";
import { resolveRollFormula, withAcing } from "../scripts/roll-insights.js";
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, actual + " ≠ " + expected);

describe("roll statistics", () => {
  for (const [formula, minimum, maximum, average] of [
    ["1d1", 1, 1, 1], ["1d6", 1, 6, 3.5], ["2d6+3", 5, 15, 10], ["(2d6+3)*2", 10, 30, 20],
    ["1d6x-2", -1, Infinity, 2.2], ["1d4x", 1, Infinity, 10/3], ["1-1d6x", -Infinity, 0, -3.2],
    ["{1d6x,1dw6}kh", 1, Infinity, 5.8], ["2d20kh", 1, 20, 13.825],
    ["{1d6,1d6}kl", 1, 6, 91/36], ["4d6kh3", 3, 18, 12.2445987654321],
    ["1d6ro1", 1, 6, 47/12], ["1d6r1", 2, 6, 4], ["1d6xo", 1, 12, 49/12],
    ["2dF", -2, 2, 0], ["1dc", 0, 1, 0.5], ["floor(1d6/2)", 0, 3, 1.5],
    ["max(1d6,4)", 4, 6, 4.5], ["1d6xmax4", 1, 4, 3],
    ["1d6x^2", 1, Infinity, 28.28],
  ]) it("analyzes " + formula, () => {
    const result = rollStatistics(formula); assert.ok(result);
    assert.equal(result.minimum, minimum); assert.equal(result.maximum, maximum); near(result.average, average);
  });
  it("keeps Wild Die critical failures separate from ordinary failures", () => {
    const result = rollStatistics("{1d6x,1dw6}kh", { trait: true });
    near(result.outcomes[0], 1/36); near(result.outcomes[0]+result.outcomes[1], 0.25);
    near(result.outcomes.reduce((a,b)=>a+b,0),1); near(result.cdf(3),0.25);
  });
  it("ignores positive modifiers when testing snake eyes", () => {
    const result = rollStatistics("{1d6x,1dw6}kh+12", { trait: true });
    near(result.outcomes[0],1/36); near(result.outcomes[4],35/36); near(result.outcomes[1],0);
  });
  it("applies penalties to both skill and Wild Die", () => {
    const result = rollStatistics("{1d4x,1dw6}kh-2", { trait:true });
    near(result.outcomes[0],1/24); near(result.outcomes[0]+result.outcomes[1],65/96);
  });
  it("handles an Extra's unconfirmed critical-failure probability", () => {
    const result = rollStatistics("{1d8x}kh", { trait:true });
    near(result.outcomes[0],1/8); near(result.outcomes[0]+result.outcomes[1],3/8);
  });
  it("uses the native majority-of-dice and Wild Die rule for a volley", () => {
    const result = rollStatistics("{1d6x,1d6x,1d6x,1dw6}kh3", { trait:true,bestShot:true });
    assert.ok(result); near(result.outcomes[0],16/1296);
  });
  it("estimates large keep pools with honest bounds and a separate local RNG",()=>{
    const formula="{1d6x,1d6x,1d6x,1dw6}kh3";
    const result=rollStatistics(formula);
    const smallest=rollStatistics("{1d6x,1d6x,1d6x,1dw6}kl");
    assert.ok(result.approximate);assert.equal(result.minimum,3);assert.equal(result.maximum,Infinity);
    near(result.average,4*4.2-smallest.average,.1);
    assert.strictEqual(rollStatistics(formula),result);
  });
  it("updates odds for target numbers, while all five buckets still sum to one", () => {
    const easy=rollStatistics("{1d8x,1dw6}kh",{trait:true,target:4});
    const hard=rollStatistics("{1d8x,1dw6}kh",{trait:true,target:8});
    assert.ok(hard.outcomes[1]>easy.outcomes[1]); near(hard.outcomes.reduce((a,b)=>a+b,0),1);
  });
  it("centers the average and clamps extreme results", () => {
    const finite=rollStatistics("2d6");
    near(rangePosition(finite,2),0);near(rangePosition(finite,7),0.5);near(rangePosition(finite,12),1);
    const acing=rollStatistics("1d6x");
    near(rangePosition(acing,acing.average),0.5);near(rangePosition(acing,acing.minimum),0);assert.ok(rangePosition(acing,80)>.99);
  });
  it("resolves nested roll data without executing JavaScript", () => {
    assert.equal(resolveRollFormula("@str+@bonus",{str:"1d8",bonus:2}),"(1d8)+(2)");
    assert.equal(withAcing("1d8+1d6x",true),"1d8x+1d6x");
    assert.equal(withAcing("1d8x+1d6x",false),"1d8+1d6");
    assert.equal(withAcing("1d1+1d6",true),"1d1+1d6x");
    assert.equal(rollStatistics(resolveRollFormula("@missing",{})),null);
    assert.equal(rollStatistics("globalThis.alert(1)"),null);
  });
  it("rejects infinite loops and excessive formulas without rolling dice", () => {
    for(const formula of ["1d6r>=1","1d6x>=1","99999d6","1d1x","1d6/0","1d6zz","1d6;throw 1"])
      assert.equal(rollStatistics(formula),null,formula);
    assert.throws(()=>parseFormula("(1d6"));
  });
});
