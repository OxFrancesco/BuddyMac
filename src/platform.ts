import { dlopen, FFIType, ptr } from 'bun:ffi'
import { dirname, resolve } from 'node:path'
const packaged=process.execPath.includes('.app/Contents/MacOS/')
const root=packaged?dirname(process.execPath):resolve(import.meta.dir,'../dist/native')
const library=dlopen(resolve(root,'libbuddymac.dylib'),{
 buddymac_login_enabled:{args:[],returns:FFIType.bool},
 buddymac_set_login:{args:[FFIType.bool],returns:FFIType.cstring},
 buddymac_prompt_secret:{args:[],returns:FFIType.cstring},
 buddymac_keep_running:{args:[],returns:FFIType.void},
 buddymac_init:{args:[FFIType.ptr],returns:FFIType.void},
 buddymac_menu:{args:[],returns:FFIType.void},
 buddymac_next_action:{args:[],returns:FFIType.cstring},
 buddymac_drag:{args:[FFIType.ptr],returns:FFIType.int},
 buddymac_copy_text:{args:[FFIType.ptr],returns:FFIType.void},
 buddymac_record_shortcut:{args:[FFIType.bool,FFIType.bool],returns:FFIType.void},
 buddymac_key_label:{args:[FFIType.int],returns:FFIType.cstring},
 buddymac_register_hotkeys:{args:[FFIType.ptr],returns:FFIType.cstring},
 buddymac_status_title:{args:[FFIType.ptr],returns:FFIType.void},
 buddymac_pointer_state:{args:[],returns:FFIType.cstring},
 buddymac_hide_window:{args:[],returns:FFIType.void},
 buddymac_show_window:{args:[],returns:FFIType.void},
 buddymac_window_visible:{args:[],returns:FFIType.bool},
 buddymac_window_key:{args:[],returns:FFIType.bool},
})
function cString(value:string){return Buffer.from(value+'\0')}
export function initializePlatform(){const path=cString(packaged?resolve(root,'../Resources/fonts'):resolve(import.meta.dir,'../assets/fonts'));library.symbols.buddymac_init(ptr(path))}
export function installMenu(){library.symbols.buddymac_menu()}
export function nextPlatformAction(){return String(library.symbols.buddymac_next_action())}
export function dragFiles(paths:string[]){const data=cString(JSON.stringify(paths));return library.symbols.buddymac_drag(ptr(data))===1}
export function copyText(text:string){const data=cString(text);library.symbols.buddymac_copy_text(ptr(data))}

export function promptSecret(){return String(library.symbols.buddymac_prompt_secret())}
export function keepRunning(){library.symbols.buddymac_keep_running()}
export function showWindow(){library.symbols.buddymac_show_window()}

export const loginEnabled=()=>packaged&&library.symbols.buddymac_login_enabled()
export function setLogin(enabled:boolean){if(!packaged)throw new Error("Open the installed BuddyMac app to change login settings.");const error=String(library.symbols.buddymac_set_login(enabled));if(error)throw new Error(error);return loginEnabled()}

const panes={
 microphone:'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
 accessibility:'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
 screen:'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
 appManagement:'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles',
 automation:'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
 notifications:'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
 loginItems:'x-apple.systempreferences:com.apple.LoginItems-Settings.extension',
 keyboard:'x-apple.systempreferences:com.apple.Keyboard-Settings.extension',
} as const
export type SettingsPane=keyof typeof panes
export function openSettingsPane(pane:SettingsPane){void Bun.spawn(['/usr/bin/open',panes[pane]]).exited}
export async function chooseSaveLocation(defaultName:string,prompt:string):Promise<string|null>{
 const child=Bun.spawn(['/usr/bin/osascript','-e','on run argv','-e','POSIX path of (choose file name with prompt (item 2 of argv) default name (item 1 of argv))','-e','end run',defaultName,prompt],{stdout:'pipe',stderr:'pipe'})
 const [out,code]=await Promise.all([new Response(child.stdout).text(),child.exited])
 return code===0&&out.trim()?out.trim():null
}
export async function appBundleInfo(appPath:string):Promise<{bundleID:string;name:string}>{
 const read=async(key:string)=>{const child=Bun.spawn(['/usr/bin/plutil','-extract',key,'raw','-o','-',`${appPath}/Contents/Info.plist`],{stdout:'pipe',stderr:'ignore'});const [out,code]=await Promise.all([new Response(child.stdout).text(),child.exited]);return code===0?out.trim():''}
 const bundleID=await read('CFBundleIdentifier')
 if(!bundleID)throw new Error('Choose an application.')
 return {bundleID,name:await read('CFBundleDisplayName')||await read('CFBundleName')||appPath.split('/').at(-1)?.replace(/\.app$/,'')||bundleID}
}

export const recordShortcut=(enabled:boolean,allowFn=false)=>library.symbols.buddymac_record_shortcut(enabled,allowFn)
export const nativeKeyLabel=(keyCode:number)=>String(library.symbols.buddymac_key_label(keyCode))
export interface GlobalHotkey{id:string;keyCode:number;modifiers:number}
export function registerHotkeys(hotkeys:GlobalHotkey[]){const failed=String(library.symbols.buddymac_register_hotkeys(ptr(cString(JSON.stringify(hotkeys)))));return failed?failed.split(','):[]}
export function setStatusTitle(title:string){library.symbols.buddymac_status_title(ptr(cString(title)))}
export interface PointerState{x:number;y:number;down:boolean;screens:{x:number;y:number;width:number;height:number;notch:number;visibleTop:number}[];window:{x?:number;y?:number;width?:number;height?:number;visible:boolean;key?:boolean}}
export function pointerState():PointerState{return JSON.parse(String(library.symbols.buddymac_pointer_state()))}
export const hideWindow=()=>library.symbols.buddymac_hide_window()
export const windowVisible=()=>library.symbols.buddymac_window_visible()
export const windowKey=()=>library.symbols.buddymac_window_key()
