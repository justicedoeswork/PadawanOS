export const BUSINESS_TIME_ZONE='America/New_York';
export type CalendarRange='today'|'tomorrow'|'week'|'next';
function easternParts(date:Date):Record<string,number>{
  return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:BUSINESS_TIME_ZONE,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function midnight(now:Date,offsetDays:number):Date {
  const parts=easternParts(now);
  const target=Date.UTC(parts.year!,parts.month!-1,parts.day!+offsetDays);
  let instant=target;
  // Convert a business calendar date to an instant. Resolve each midnight
  // separately so DST days correctly span 23 or 25 hours, never browser-local time.
  for(let i=0;i<3;i++){
    const wall=easternParts(new Date(instant));
    const represented=Date.UTC(wall.year!,wall.month!-1,wall.day!,wall.hour!,wall.minute!,wall.second!);
    instant+=target-represented;
  }
  return new Date(instant);
}
export function calendarWindow(range:CalendarRange,now=new Date()):{start:string;end:string}{
  if(range==='next'||range==='week')return {start:now.toISOString(),end:new Date(now.getTime()+7*24*60*60*1000).toISOString()};
  const offset=range==='tomorrow'?1:0;
  return {start:midnight(now,offset).toISOString(),end:midnight(now,offset+1).toISOString()};
}
export function calendarDayLabel(range:CalendarRange,now=new Date()):string {
  if(range==='next'||range==='week')return 'Next 7 days (Eastern time)';
  const date=new Date(calendarWindow(range,now).start);
  const label=new Intl.DateTimeFormat('en-US',{timeZone:BUSINESS_TIME_ZONE,weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(date);
  return `${range==='today'?'Today':'Tomorrow'} (${label}, Eastern time)`;
}
export function calendarEventTime(value:string,end=false):string {
  const date=new Date(value);if(Number.isNaN(date.getTime()))return 'time unavailable';
  return new Intl.DateTimeFormat('en-US',{timeZone:BUSINESS_TIME_ZONE,...(end?{}:{weekday:'short',month:'short',day:'numeric'}),hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
}
