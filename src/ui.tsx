import { useEffect, useRef, useState, Children, type ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, type StyleDesc } from '@gpuix/react'
import type { RecordedShortcut } from './shortcuts'
import { startRecording, stopRecording } from './recorder'
export const C={bg:'#000000',text:'#ffffff',muted:'#b3b3b3',line:'#222222',accent:'#d6544b',hover:'#222222'}
export const font='IBM Plex Mono'
export const display='Chakra Petch'
export const space={page:28,gap:24,inset:12,control:36,header:48}
export const markdownTheme={fontSans:font,fontMono:font,text:C.text,textMuted:C.muted,accent:C.accent,border:C.line,bg:C.bg,metrics:{mdTextSize:13,mdLineHeight:21}}
export function Text({children,muted=false,size=13,style={}}:{children:ReactNode;muted?:boolean;size?:number;style?:StyleDesc}){const parts=Children.toArray(children);const content=parts.every(value=>typeof value==='string'||typeof value==='number')?parts.join(''):children;return <text style={{color:muted?C.muted:C.text,fontFamily:font,fontSize:size,...style}}>{content}</text>}
export function Button({children,onClick,id,disabled=false,primary=false,quiet=false}:{children:string;onClick:()=>void;id?:string;disabled?:boolean;primary?:boolean;quiet?:boolean}){
 const [focused,setFocused]=useState(false)
 return <div testId={id} role="button" aria-label={children} tabIndex={disabled?-1:0} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} onClick={()=>{if(!disabled)onClick()}} onKeyDown={event=>{if(!disabled&&(event.key==='enter'||event.key==='space'))onClick()}} style={{display:'flex',flexDirection:'row',height:space.control,paddingLeft:quiet?space.inset:14,paddingRight:quiet?space.inset:14,alignItems:'center',justifyContent:'center',flexShrink:0,backgroundColor:primary?C.text:C.bg,borderWidth:quiet?0:1,borderColor:focused?C.accent:C.text,opacity:disabled?0.4:1,cursor:disabled?'default':'pointer',hover:{backgroundColor:primary?C.accent:C.hover},userSelect:'none'}}><Text size={12} style={{color:primary?C.bg:C.text}}>{children}</Text></div>
}
export function Row({children,style={},testId}:{children:ReactNode;style?:StyleDesc;testId?:string}){return <div testId={testId} style={{display:'flex',flexDirection:'row',alignItems:'center',gap:12,...style}}>{children}</div>}
export function Column({children,style={},testId}:{children:ReactNode;style?:StyleDesc;testId?:string}){return <div testId={testId} style={{display:'flex',flexDirection:'column',gap:12,minWidth:0,...style}}>{children}</div>}
export function Panel({children,testId,style={}}:{children:ReactNode;testId?:string;style?:StyleDesc}){return <div testId={testId} style={{display:'flex',flexDirection:'column',gap:16,flexShrink:0,padding:16,borderWidth:1,borderColor:C.line,...style}}>{children}</div>}
/** Label above a control that shares a row with its siblings. */
export function Labeled({label,children}:{label:string;children:ReactNode}){return <Column style={{flexGrow:1,flexBasis:0,gap:8}}><Text muted size={11}>{label}</Text>{children}</Column>}
/** Label above a control stacked in a column. Labeled's zero flex basis collapses there, because Taffy has no automatic minimum height. */
export function Stacked({label,children}:{label:string;children:ReactNode}){return <Column style={{gap:8,flexShrink:0}}><Text muted size={11}>{label}</Text>{children}</Column>}
export function Field({value,onChange,placeholder,id,multiline=false,height=space.control,onSubmit,autoFocus=false}:{value:string;onChange:(value:string)=>void;placeholder?:string;id:string;multiline?:boolean;height?:number;onSubmit?:()=>void;autoFocus?:boolean}){
 const inset=space.inset-1
 const style:StyleDesc={height,minHeight:height,width:'100%',minWidth:0,flexGrow:0,flexShrink:multiline?0:1,paddingLeft:inset,paddingRight:inset,paddingTop:multiline?inset:0,paddingBottom:multiline?inset:0,backgroundColor:C.bg,borderWidth:1,borderColor:C.line,color:C.text,fontSize:13,fontFamily:font}
 const props={value,onChange:(event:{value?:string})=>onChange(event.value??''),placeholder,testId:id,'aria-label':placeholder??id,style,...autoFocus?{autoFocus:true}:{}}
 return multiline?<textarea {...props} onSubmit={onSubmit}/>:<input {...props} onSubmit={onSubmit}/>
}
export function ErrorText({message}:{message:string}){return message?<Text style={{color:C.accent}}>{message}</Text>:null}
export function Empty({children}:{children:string}){return <div style={{paddingTop:16,paddingBottom:16,paddingLeft:space.inset,paddingRight:space.inset}}><Text muted>{children}</Text></div>}
export const slug=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-')
export function Tabs<T extends string>({items,value,onChange,id}:{items:readonly T[];value:T;onChange:(value:T)=>void;id:string}){
 return <div role="tablist" style={{display:'flex',flexDirection:'row',gap:24,flexShrink:0,borderBottomWidth:1,borderColor:C.line}}>{items.map(item=><div key={item} testId={`${id}-tab-${slug(item)}`} role="tab" aria-label={item} aria-selected={value===item} tabIndex={0} onClick={()=>onChange(item)} onKeyDown={event=>{if(event.key==='enter'||event.key==='space')onChange(item)}} style={{display:'flex',flexDirection:'row',alignItems:'center',height:space.control,borderBottomWidth:2,borderColor:value===item?C.accent:C.bg,cursor:'pointer',userSelect:'none'}}><Text size={13} muted={value!==item}>{item}</Text></div>)}</div>
}
export function Check({label,checked,onChange,id,disabled=false}:{label:string;checked:boolean;onChange:(value:boolean)=>void;id?:string;disabled?:boolean}){
 return <div testId={id} role="checkbox" aria-label={label} aria-checked={checked} tabIndex={disabled?-1:0} onClick={()=>{if(!disabled)onChange(!checked)}} onKeyDown={event=>{if(!disabled&&(event.key==='enter'||event.key==='space'))onChange(!checked)}} style={{display:'flex',flexDirection:'row',alignItems:'center',gap:10,height:28,flexShrink:0,opacity:disabled?0.4:1,cursor:disabled?'default':'pointer',userSelect:'none'}}><div style={{display:'flex',alignItems:'center',justifyContent:'center',width:16,height:16,flexShrink:0,borderWidth:1,borderColor:C.text,backgroundColor:checked?C.text:C.bg}}>{checked?<Text size={11} style={{color:C.bg}}>✓</Text>:null}</div><Text>{label}</Text></div>
}
export function Setting({label,detail,children,id}:{label:string;detail?:string;children?:ReactNode;id?:string}){
 return <div testId={id} style={{display:'flex',flexDirection:'row',alignItems:'center',gap:space.gap,flexShrink:0,minHeight:space.control+24,paddingTop:12,paddingBottom:12,borderBottomWidth:1,borderColor:C.line}}><Column style={{flexGrow:1,flexBasis:0,gap:4}}><Text>{label}</Text>{detail?<Text muted size={11}>{detail}</Text>:null}</Column>{children?<Row style={{flexShrink:0}}>{children}</Row>:null}</div>
}
export function Group({title,children}:{title?:string;children:ReactNode}){
 return <Column style={{gap:0,flexShrink:0}}>{title?<Text muted size={11} style={{paddingBottom:4}}>{title}</Text>:null}{children}</Column>
}
export function ShortcutField({value,onRecord,onClear,id}:{value:string;onRecord:(shortcut:RecordedShortcut)=>void;onClear?:()=>void;id:string}){
 const [recording,setRecording]=useState(false)
 const callback=useRef<((shortcut:RecordedShortcut|null)=>void)|null>(null)
 useEffect(()=>()=>{if(callback.current)stopRecording(callback.current)},[])
 function toggle(){
  if(recording&&callback.current){stopRecording(callback.current);callback.current=null;setRecording(false);return}
  const next=(shortcut:RecordedShortcut|null)=>{callback.current=null;setRecording(false);if(shortcut)onRecord(shortcut)}
  callback.current=next;setRecording(true);startRecording(next)
 }
 return <Row style={{gap:0}}><div testId={id} role="button" aria-label={value?`Shortcut ${value}. Click to change`:'Record a shortcut'} tabIndex={0} onClick={toggle} onKeyDown={event=>{if(!recording&&(event.key==='enter'||event.key==='space'))toggle()}} style={{display:'flex',flexDirection:'row',alignItems:'center',height:space.control,minWidth:240,paddingLeft:space.inset-1,paddingRight:space.inset-1,borderWidth:1,borderColor:recording?C.accent:C.line,cursor:'pointer',userSelect:'none'}}><Text muted={!value&&!recording} style={recording?{color:C.accent}:{}}>{recording?'Press the new shortcut. Escape cancels.':value||'Not set'}</Text></div>{onClear&&value&&!recording?<Button quiet onClick={onClear}>Clear</Button>:null}</Row>
}
export function Header({title,actions,compact=false}:{title:string;actions?:ReactNode;compact?:boolean}){return <Row style={{justifyContent:'space-between',height:compact?space.control:space.header,flexShrink:0}}><text role="heading" aria-level={1} style={{fontFamily:display,fontWeight:700,fontSize:compact?24:30,color:C.text}}>{title.toUpperCase()}</text>{actions}</Row>}
export function Page({children,compact=false,scroll=false}:{children:ReactNode;compact?:boolean;scroll?:boolean}){return <div style={{display:'flex',flexDirection:'column',flexGrow:1,minWidth:0,height:'100%',padding:compact?16:space.page,gap:compact?12:space.gap,...scroll?{overflowY:'scroll'}:{}}}>{children}</div>}
export function Section({title,actions,children}:{title:string;actions?:ReactNode;children:ReactNode}){return <Page scroll><Header title={title} actions={actions}/>{children}</Page>}
export function TabbedPage<T extends string>({title,actions,items,tab,onTab,id,children,scroll=true,compact=false}:{title:string;actions?:ReactNode;items:readonly T[];tab:T;onTab:(tab:T)=>void;id:string;children:ReactNode;scroll?:boolean;compact?:boolean}){
 return <Page compact={compact}><Header title={title} actions={actions} compact={compact}/>{items.length>1&&!compact?<Tabs items={items} value={tab} onChange={onTab} id={id}/>:null}<div style={{display:'flex',flexDirection:'column',flexGrow:1,minHeight:0,gap:16,...scroll?{overflowY:'scroll'}:{}}}>{children}</div></Page>
}
export function Choice({value,items,onChange,id,width=240}:{value:string;items:readonly {value:string;label:string}[];onChange:(value:string)=>void;id:string;width?:number}){
 const label=items.find(item=>item.value===value)?.label??value
 return <Select items={items} value={value} onValueChange={onChange} style={{flexShrink:0}}><div style={{position:'relative',display:'flex'}}>
  <SelectTrigger testId={id} style={state=>({display:'flex',flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,height:space.control,width,paddingLeft:space.inset-1,paddingRight:space.inset-1,borderWidth:1,borderColor:state.open?C.text:C.line,cursor:'pointer',hover:{borderColor:C.text}})}><Text>{label}</Text><Text muted size={11}>▾</Text></SelectTrigger>
  <SelectContent side="bottom" sideOffset={4} style={{display:'flex',flexDirection:'column',minWidth:width,maxHeight:300,overflowY:'scroll',paddingTop:4,paddingBottom:4,backgroundColor:C.bg,borderWidth:1,borderColor:C.text}}>{items.map(item=><SelectItem key={item.value} value={item.value} style={state=>({display:'flex',flexDirection:'row',alignItems:'center',height:32,flexShrink:0,paddingLeft:space.inset-1,paddingRight:space.inset-1,backgroundColor:state.highlighted?C.hover:C.bg,cursor:'pointer',hover:{backgroundColor:C.hover}})}>{state=><Text style={{color:state.selected?C.accent:C.text}}>{item.label}</Text>}</SelectItem>)}</SelectContent>
 </div></Select>
}
export function Intro({text,children}:{text:string;children?:ReactNode}){return <div style={{display:'flex',flexDirection:'row',alignItems:'center',gap:space.gap,flexShrink:0}}><Text muted size={11} style={{flexGrow:1,flexBasis:0,minWidth:0}}>{text}</Text>{children?<Row style={{flexShrink:0}}>{children}</Row>:null}</div>}
