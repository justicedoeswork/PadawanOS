import {describe,it,expect} from 'vitest';
import {createVoiceActivity} from './voiceActivity';
import {currentSessionTurns} from './managerSession';
describe('automatic voice turns',()=>{
  it('waits through a thinking pause then submits once speech ends',()=>{
    const sample=createVoiceActivity(0);
    for(let t=50;t<=500;t+=50)expect(sample(.04,t)).toBe('listen');
    expect(sample(0,1500)).toBe('listen');
    expect(sample(.04,1550)).toBe('listen');
    expect(sample(0,2900)).toBe('listen');
    expect(sample(0,2950)).toBe('submit');
  });
  it('does not upload silence or a brief click',()=>{
    const sample=createVoiceActivity(0);
    sample(.1,50);
    expect(sample(0,20000)).toBe('quiet');
  });
  it('bounds continuous speech to one minute',()=>{
    const sample=createVoiceActivity(0);
    for(let t=50;t<60000;t+=50)expect(sample(.04,t)).toBe('listen');
    expect(sample(.04,60000)).toBe('submit');
  });
});
it('restores only this login while leaving durable records untouched',()=>{
  const turns=[{created_at:'2026-09-29T10:00:00Z'},{created_at:'2026-09-29T11:00:00Z'},{created_at:'invalid'}];
  expect(currentSessionTurns(turns,Date.parse('2026-09-29T11:00:00Z'))).toEqual([turns[1]]);
  expect(turns).toHaveLength(3);
});
