import test from 'node:test';import assert from 'node:assert/strict';import {backtest} from '../src/backtest.js';
test('backtest refuses zero-prior-data fabricated evaluation',()=>{const r=backtest([],[{season:2027,date:'2026-11-12',homeId:'1',awayId:'2',homePoints:73,awayPoints:72}]);assert.deepEqual(r,{games:0,accuracy:null,brier:null,logLoss:null,marginMAE:null,calibration:[]});});
