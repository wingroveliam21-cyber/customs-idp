import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, SlidersHorizontal } from "lucide-react";
import { PackTable } from "../SharedComponents.jsx";
import { DEFAULT_INBOX_COLUMNS, DEFAULT_INBOX_COLUMN_KEYS, normaliseInboxColumnSelection } from "../../domain/packData.js";

const INBOX_COLUMNS_STORAGE_KEY="customs-idp-inbox-columns";
const INBOX_COLUMNS_STORAGE_VERSION=3;
const columnStorageKey=userKey=>INBOX_COLUMNS_STORAGE_KEY+":"+(String(userKey||"default").trim()||"default");

function loadInboxColumns(storageKey){
  try{
    const saved=normaliseInboxColumnSelection(JSON.parse(localStorage.getItem(storageKey)||"null"));
    return saved;
  }
  catch{return [...DEFAULT_INBOX_COLUMN_KEYS];}
}

function InboxPage({packs,query,setQuery,openPack,title="Inbox",onAssign,onDelete,packLoadError,packsLoading,currentUserKey}){
 const storageKey=columnStorageKey(currentUserKey);
 const [columns,setColumns]=useState(()=>loadInboxColumns(storageKey));
 const [columnMenuOpen,setColumnMenuOpen]=useState(false);
 const columnPickerRef=useRef(null);

 useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(columns));localStorage.setItem(storageKey+":version",String(INBOX_COLUMNS_STORAGE_VERSION));}catch{}},[columns,storageKey]);
 useEffect(()=>{
   if(!columnMenuOpen)return undefined;
   const closeOnOutsideClick=event=>{if(!columnPickerRef.current?.contains(event.target))setColumnMenuOpen(false);};
   const closeOnEscape=event=>{if(event.key==="Escape")setColumnMenuOpen(false);};
   document.addEventListener("pointerdown",closeOnOutsideClick);
   document.addEventListener("keydown",closeOnEscape);
   return()=>{document.removeEventListener("pointerdown",closeOnOutsideClick);document.removeEventListener("keydown",closeOnEscape);};
 },[columnMenuOpen]);

 const toggleColumn=key=>setColumns(current=>{
   if(current.includes(key))return current.length===1?current:current.filter(column=>column!==key);
   return [...current,key];
 });
 const resetColumns=()=>setColumns([...DEFAULT_INBOX_COLUMN_KEYS]);

 return <section><div className="page-head"><div><div className="eyebrow">Document processing</div><h1>{title}</h1><p>Review incoming document packs, extraction confidence and validation status.</p></div><button className="primary" onClick={()=>document.querySelector(".hidden-upload")?.click()}><Plus size={17}/> Upload documents</button></div>
 {packLoadError&&<div className="email-sync-debug error"><strong>Inbox database</strong><span>{packLoadError}</span></div>}
 <div className="toolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search packs, customers or tickets..."/></div><button className="filter">Status <ChevronDown size={15}/></button><button className="filter">Customer <ChevronDown size={15}/></button><div className="column-picker" ref={columnPickerRef}><button className="filter" type="button" aria-expanded={columnMenuOpen} onClick={()=>setColumnMenuOpen(open=>!open)}><SlidersHorizontal size={15}/> Columns <ChevronDown size={15}/></button>{columnMenuOpen&&<div className="column-menu"><div className="column-menu-head"><b>Inbox columns</b><button type="button" className="text-btn" onClick={resetColumns}>Reset</button></div><p>Choose which columns appear in the inbox.</p>{DEFAULT_INBOX_COLUMNS.map(column=>{const selected=columns.includes(column.key),lastSelected=selected&&columns.length===1;return <label key={column.key} className={"column-menu-item "+(lastSelected?"disabled":"")}><input type="checkbox" checked={selected} disabled={lastSelected} onChange={()=>toggleColumn(column.key)}/><span>{column.label}</span>{selected&&<Check size={15}/>}</label>})}</div>}</div></div>
 <div className="panel">
   {packsLoading
     ? <div className="inbox-data-state"><strong>Loading inbox…</strong><span>Fetching live document packs.</span></div>
     : packLoadError
       ? <div className="inbox-data-state error"><strong>Unable to load inbox</strong><span>The live inbox data could not be loaded. Please refresh and try again.</span></div>
       : packs.length===0
         ? <div className="inbox-data-state"><strong>No document packs</strong><span>There are currently no document packs in the inbox.</span></div>
         : <PackTable packs={packs} onOpen={openPack} onAssign={onAssign} onDelete={onDelete} columns={columns}/>}
 </div></section>
}

export { InboxPage };
