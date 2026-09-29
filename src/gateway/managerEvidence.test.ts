import {describe,expect,it} from 'vitest';
import {persistableAnswer,restoreAnswer} from './managerEvidence';
describe('call evidence in durable turns',()=>{
  it('restores the concise answer separately from its original evidence',()=>{
    const text='Your call covered the roof schedule.';
    const evidence='Evidence: “Timing is still uncertain.”\nSource call: original-call';
    expect(restoreAnswer(persistableAnswer(text,evidence))).toEqual({text,evidence});
  });
  it('keeps older plain text turns and expanded evidence unchanged',()=>{
    expect(restoreAnswer('Older answer')).toEqual({text:'Older answer'});
    expect(persistableAnswer('Exact excerpt','Exact excerpt')).toBe('Exact excerpt');
  });
});
