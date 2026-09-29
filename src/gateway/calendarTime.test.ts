import {afterEach,describe,expect,it,vi} from 'vitest';
import {calendarWindow,calendarDayLabel,calendarEventTime} from './calendarTime';
import {executeManagerIntent} from './managerCommunications';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('Eastern business calendar dates',()=>{
 it('keeps today on the Eastern date when UTC has already reached tomorrow',()=>{
   const now=new Date('2026-09-30T02:00:00Z');
   expect(calendarWindow('today',now)).toEqual({start:'2026-09-29T04:00:00.000Z',end:'2026-09-30T04:00:00.000Z'});
   expect(calendarWindow('tomorrow',now)).toEqual({start:'2026-09-30T04:00:00.000Z',end:'2026-10-01T04:00:00.000Z'});
   expect(calendarDayLabel('today',now)).toContain('Tue, Sep 29, 2026');
   expect(calendarDayLabel('tomorrow',now)).toContain('Wed, Sep 30, 2026');
 });
 it.each([
   ['2026-03-08T12:00:00Z','2026-03-08T05:00:00.000Z','2026-03-09T04:00:00.000Z'],
   ['2026-11-01T12:00:00Z','2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z'],
 ])('uses separate DST-aware midnights for %s',(now,start,end)=>expect(calendarWindow('today',new Date(now))).toEqual({start,end}));
 it('rolls tomorrow into the next year',()=>{
   expect(calendarWindow('tomorrow',new Date('2026-12-31T17:00:00Z'))).toEqual({start:'2027-01-01T05:00:00.000Z',end:'2027-01-02T05:00:00.000Z'});
 });
 it('displays an evening event on its Eastern day rather than its UTC day',()=>{
   expect(calendarEventTime('2026-09-30T00:30:00Z')).toContain('Tue, Sep 29');
   expect(calendarEventTime('2026-09-30T00:30:00Z')).toContain('8:30 PM EDT');
 });
 it('uses the same business date for the request and answer label across a midnight response',async()=>{
   vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-30T03:59:59Z'));
   const fake=vi.fn(async()=>{
     vi.setSystemTime(new Date('2026-09-30T04:00:01Z'));
     return new Response(JSON.stringify({data:[{subject:'Roof meeting',startAt:'2026-09-29T18:00:00Z',endAt:'2026-09-29T19:00:00Z'}]}));
   });vi.stubGlobal('fetch',fake);
   const reply=await executeManagerIntent({kind:'calendar',range:'today'});
   const query=new URL(String((fake.mock.calls as unknown as [string][])[0]![0]),'https://app.example.test').searchParams;
   expect(query.get('start')).toBe('2026-09-29T04:00:00.000Z');
   expect(query.get('end')).toBe('2026-09-30T04:00:00.000Z');
   expect(reply.text).toContain('Today (Tue, Sep 29, 2026, Eastern time)');
   expect(reply.text).toContain('2:00 PM EDT');
 });
});
