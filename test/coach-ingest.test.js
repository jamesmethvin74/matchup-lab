import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublishedCoaches,normalizeTeamLabel} from '../src/coach-ingest.js';
test('parses source-traceable head coach rows',()=>{
 const table='<table class="wikitable sortable"><tr><th>Team</th><th>Conference</th><th>Current coach</th><th>Since</th></tr>'+
 Array.from({length:320},(_,i)=>'<tr><td><a>School '+i+' Wildcats</a></td><td>C</td><td><span>Coach '+i+'</span></td><td>2026–27</td></tr>').join('')+'</table>';
 const coaches=parsePublishedCoaches('intro'.padEnd(1000,'.')+table);
 assert.equal(coaches.length,320);assert.equal(coaches[0].coach,'Coach 0');
 assert.equal(normalizeTeamLabel('Arkansas–Pine Bluff'), 'arkansas pine bluff');
});
test('fails closed if there is no source table',()=>assert.throws(()=>parsePublishedCoaches('x'.repeat(1200))));
