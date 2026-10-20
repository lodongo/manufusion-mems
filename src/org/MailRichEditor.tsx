import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, AlignJustify, Bold, ChevronDown, Highlighter, Indent, Italic, Link2, List, ListOrdered, Minus, Outdent, Quote, Redo2, RemoveFormatting, Settings2, Strikethrough, Table2, Underline, Undo2, Maximize2, Minimize2 } from 'lucide-react';
import { firebaseAuth } from '../firebase';
import { appAlert, appPrompt } from '../components/dialogs';

type EditorProps = {html:string;onChange:(html:string)=>void;placeholder?:string;ariaLabel?:string};
type ToolKey='bold'|'italic'|'underline'|'bullets'|'link'|'numbered'|'strikethrough'|'alignleft'|'aligncenter'|'alignright'|'justify'|'indent'|'outdent'|'table'|'quote'|'rule'|'remove'|'undo'|'redo'|'font'|'size'|'color'|'highlight'|'heading';
type Tool={id:ToolKey;label:string;Icon?:typeof Bold;cmd?:string};
const TOOLS:Tool[]=[
    {id:'bold',label:'Bold',Icon:Bold,cmd:'bold'},
    {id:'italic',label:'Italic',Icon:Italic,cmd:'italic'},
    {id:'underline',label:'Underline',Icon:Underline,cmd:'underline'},
    {id:'bullets',label:'Bulleted list',Icon:List,cmd:'insertUnorderedList'},
    {id:'link',label:'Insert link',Icon:Link2},
    {id:'numbered',label:'Numbered list',Icon:ListOrdered,cmd:'insertOrderedList'},
    {id:'strikethrough',label:'Strikethrough',Icon:Strikethrough,cmd:'strikeThrough'},
    {id:'alignleft',label:'Align left',Icon:AlignLeft,cmd:'justifyLeft'},
    {id:'aligncenter',label:'Center',Icon:AlignCenter,cmd:'justifyCenter'},
    {id:'alignright',label:'Align right',Icon:AlignRight,cmd:'justifyRight'},
    {id:'justify',label:'Justify',Icon:AlignJustify,cmd:'justifyFull'},
    {id:'indent',label:'Indent',Icon:Indent,cmd:'indent'},
    {id:'outdent',label:'Outdent',Icon:Outdent,cmd:'outdent'},
    {id:'table',label:'Insert table',Icon:Table2},
    {id:'quote',label:'Quote',Icon:Quote,cmd:'formatBlock'},
    {id:'rule',label:'Horizontal line',Icon:Minus,cmd:'insertHorizontalRule'},
    {id:'remove',label:'Clear formatting',Icon:RemoveFormatting,cmd:'removeFormat'},
    {id:'undo',label:'Undo',Icon:Undo2,cmd:'undo'},
    {id:'redo',label:'Redo',Icon:Redo2,cmd:'redo'},
    {id:'font',label:'Font family'},
    {id:'size',label:'Font size'},
    {id:'color',label:'Font color'},
    {id:'highlight',label:'Highlight'},
    {id:'heading',label:'Heading style'},
];
const DEFAULT:ToolKey[]=['bold','italic','underline','bullets','link'];
const key=()=> 'mems.mail.toolbar.v1.'+(firebaseAuth.currentUser?.uid||'guest');
const buttonStyle='flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs text-ink hover:bg-brand/10';
const HEIGHTS=[180,280,400,560];
function savedTools():ToolKey[]{
    try{
        const stored=JSON.parse(localStorage.getItem(key())||'null');
        if(Array.isArray(stored)&&stored.length===5&&new Set(stored).size===5
            &&stored.every(k=>TOOLS.some(t=>t.id===k)))return stored as ToolKey[];
    }catch{/* Default when browser preferences are unavailable. */}
    return DEFAULT;
}
export default function MailRichEditor({html,onChange,placeholder='Write your message…',ariaLabel='Email body'}:EditorProps){
    const editor=useRef<HTMLDivElement>(null);
    const [primary,setPrimary]=useState<ToolKey[]>(savedTools);
    const [customize,setCustomize]=useState(false);
    const [showMore,setShowMore]=useState(false);
    const [height,setHeight]=useState(280);
    useEffect(()=>{
        if(!editor.current)return;
        // Older messages and draft HTML can contain opaque background styling.
        // Keep rich text structure, but let the current theme own the canvas.
        const fragment=document.createElement('div');
        fragment.innerHTML=html||'';
        for(const element of Array.from(fragment.querySelectorAll('*'))){
            if(element instanceof HTMLElement){
                element.style.removeProperty('background');
                element.style.removeProperty('background-color');
                element.removeAttribute('bgcolor');
            }
        }
        editor.current.innerHTML=fragment.innerHTML;
    },[]);
    const sync=()=>onChange(editor.current?.innerHTML||'');
    const command=(name:string,value?:string)=>{
        editor.current?.focus();
        document.execCommand(name,false,value);
        sync();
    };
    const clickTool=async (t:Tool)=>{
        if(t.id==='link'){
            // The in-app dialog takes focus; keep the highlighted text so the link applies to it.
            const selection=window.getSelection();
            const range=selection&&selection.rangeCount&&editor.current?.contains(selection.anchorNode)?selection.getRangeAt(0).cloneRange():null;
            const href=(await appPrompt('Paste the web address (https://...)'));
            if(href&&/^https?:\/\/\S+$/i.test(href)){
                editor.current?.focus();
                if(range){const current=window.getSelection();current?.removeAllRanges();current?.addRange(range);}
                command('createLink',href);
            }
            else if(href)void appAlert('Use a valid https:// link.');
        }else if(t.id==='table'){
            command('insertHTML','<table><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr><tr><td>Cell 3</td><td>Cell 4</td></tr></tbody></table><p><br></p>');
        }else if(t.id==='quote')command('formatBlock','BLOCKQUOTE');
        else if(t.id==='heading')command('formatBlock','H2');
        else if(t.cmd)command(t.cmd);
    };
    const control=(tool:Tool)=>{
        if(tool.id==='font')return <select key={tool.id} aria-label='Font family' className='h-11 max-w-24 rounded-lg border border-line bg-page px-1 text-xs text-ink' defaultValue='Arial' onChange={e=>command('fontName',e.target.value)}>
            {['Arial','Calibri','Georgia','Times New Roman','Verdana','Courier New'].map(x=><option key={x}>{x}</option>)}</select>;
        if(tool.id==='size')return <select key={tool.id} aria-label='Font size' className='h-11 w-16 rounded-lg border border-line bg-page px-1 text-xs text-ink' defaultValue='3' onChange={e=>command('fontSize',e.target.value)}>
            {[2,3,4,5,6,7].map(x=><option key={x} value={x}>{x===2?'10':x===3?'12':x===4?'14':x===5?'18':x===6?'24':'28'} pt</option>)}</select>;
        if(tool.id==='color'||tool.id==='highlight')return <label key={tool.id} className={buttonStyle} title={tool.label}>
            {tool.id==='highlight'?<Highlighter className='h-4 w-4'/>:<span className='text-sm font-bold'>A</span>}
            <input type='color' aria-label={tool.label} className='h-5 w-5 cursor-pointer' defaultValue={tool.id==='color'?'#000000':'#fff29a'}
                onChange={e=>command(tool.id==='color'?'foreColor':'hiliteColor',e.target.value)}/>
        </label>;
        const Icon=tool.Icon||Bold;
        return <button type='button' key={tool.id} title={tool.label} aria-label={tool.label}
            onMouseDown={e=>e.preventDefault()} onClick={()=>clickTool(tool)} className={buttonStyle}>
            <Icon className='h-[18px] w-[18px]'/>
        </button>;
    };
    const choose=(id:ToolKey)=>{
        const updated=primary.includes(id)?primary.filter(x=>x!==id):primary.length===5?primary:[...primary,id];
        setPrimary(updated);
        if(updated.length===5){
            try{localStorage.setItem(key(),JSON.stringify(updated));}catch{/*Keep preference this session.*/}
        }
    };
    const main=primary.map(k=>TOOLS.find(x=>x.id===k)).filter((t):t is Tool=>!!t);
    const rest=TOOLS.filter(t=>!primary.includes(t.id));
    const heightLabel=height>=560?'Large':height>=400?'Expanded':height>=280?'Standard':'Compact';
    return <div className='flex w-full min-w-0 flex-col rounded-xl border border-line bg-transparent'>
        <div className='flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b border-line bg-page/80 px-2 py-1.5' role='toolbar' aria-label='Email formatting'>
            <div className='flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto'>
                {main.map(control)}
            </div>
            <button type='button' aria-expanded={showMore} aria-label='More formatting options' title='More formatting' onClick={()=>{setShowMore(v=>!v);setCustomize(false)}} className={buttonStyle+' shrink-0 border-l border-line'}>
                <span className='font-semibold'>More</span><ChevronDown className='h-3.5 w-3.5'/>
            </button>
            <button type='button' aria-label='Configure five toolbar actions' title='Choose 5 toolbar buttons' onClick={()=>{setCustomize(v=>!v);setShowMore(false)}} className={buttonStyle+' shrink-0'}>
                <Settings2 className='h-4 w-4'/>
            </button>
            <button type='button' aria-label='Resize editor' title={'Editor height: '+heightLabel} onClick={()=>setHeight(x=>HEIGHTS[(HEIGHTS.indexOf(x)+1)%HEIGHTS.length])} className={buttonStyle+' shrink-0'}>
                {height>=400?<Minimize2 className='h-4 w-4'/>:<Maximize2 className='h-4 w-4'/>}
            </button>
        </div>
        {showMore&&<div role='group' aria-label='All additional formatting tools' className='flex flex-wrap items-center gap-1 border-b border-line bg-page p-2'>
            {rest.map(control)}
        </div>}
        {customize&&<div className='border-b border-line bg-page p-3'>
            <p className='mb-2 text-xs font-semibold text-ink'>Customize your five main formatting tools</p>
            <p className='mb-2 text-[11px] text-muted'>Select exactly five. Unselected tools stay available under More. Your choices are saved on this device.</p>
            <div className='flex flex-wrap gap-2'>{TOOLS.map(tool=><label key={tool.id} className={'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] '+(primary.includes(tool.id)?'border-brand bg-brand/10 text-brand':'border-line bg-panel text-ink')}>
                <input type='checkbox' checked={primary.includes(tool.id)}
                    disabled={!primary.includes(tool.id)&&primary.length===5}
                    onChange={()=>choose(tool.id)} className='h-4 w-4 accent-[rgb(var(--c-brand))]'/>
                {tool.label}
            </label>)}</div>
            <div className='mt-3 flex justify-end gap-2'>
                <button type='button' onClick={()=>{setPrimary(DEFAULT);try{localStorage.setItem(key(),JSON.stringify(DEFAULT))}catch{}}} className='min-h-11 rounded-lg border border-line px-3 text-xs text-ink'>Reset five</button>
                <button type='button' disabled={primary.length!==5} onClick={()=>setCustomize(false)} className='min-h-11 rounded-lg bg-brand px-3 text-xs text-onbrand disabled:opacity-50'>Done · {primary.length}/5</button>
            </div>
        </div>}
        <div ref={editor} role='textbox' aria-label={ariaLabel} aria-multiline='true' contentEditable
            suppressContentEditableWarning spellCheck data-placeholder={placeholder}
            onInput={sync} onBlur={sync}
            style={{height:height,minHeight:140,maxHeight:'65dvh',resize:'vertical'}}
            className='mail-rich-editor w-full overflow-y-auto bg-transparent px-4 py-4 text-sm leading-relaxed text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'/>
        <div className='flex min-h-8 items-center justify-between border-t border-line px-3 text-[11px] text-muted'>
            <span>Five favorite tools · More for all formatting</span><span>{heightLabel} · drag bottom-right corner or resize <Maximize2 className='inline h-3 w-3'/></span>
        </div>
        <style>{'.mail-rich-editor:empty:before{content:attr(data-placeholder);color:rgb(var(--c-muted));pointer-events:none}.mail-rich-editor table{border-collapse:collapse}.mail-rich-editor td,.mail-rich-editor th{border:1px solid #a1a1aa;padding:6px}.mail-rich-editor ul{list-style:disc;padding-left:1.5rem}.mail-rich-editor ol{list-style:decimal;padding-left:1.5rem}.mail-rich-editor blockquote{border-left:3px solid #999;padding-left:1rem;margin:1rem}.mail-rich-editor h1{font-size:1.75rem;font-weight:700}.mail-rich-editor h2{font-size:1.4rem;font-weight:700}.mail-rich-editor h3{font-size:1.15rem;font-weight:700}'}</style>
    </div>;
}
