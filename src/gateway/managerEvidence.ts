/** Keep persisted turns readable to older clients while separating the recap in chat. */
const separator='\n\nSupporting call evidence:\n';
export function persistableAnswer(text:string,evidence?:string):string {
  return evidence && evidence!==text ? text+separator+evidence : text;
}
export function restoreAnswer(content:string):{text:string;evidence?:string} {
  const at=content.indexOf(separator);
  return at<0?{text:content}:{text:content.slice(0,at),evidence:content.slice(at+separator.length)};
}
