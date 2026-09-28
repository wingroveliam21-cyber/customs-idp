import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertCircle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileText,
  Inbox, Mail, Menu, MoreHorizontal, Package, Plus, Search,
  Settings, ShieldCheck, Sparkles, Users, X, Zap
} from "lucide-react";
import "./styles.css";

const packs = [
  { id:"PK-10482", customer:"Acme Components Ltd", docs:4, status:"Needs review", confidence:91, received:"16 Sep 2026, 15:42", ticket:"TK-88421" },
  { id:"PK-10481", customer:"Northstar Manufacturing", docs:7, status:"Processing", confidence:96, received:"16 Sep 2026, 15:38", ticket:"TK-88420" },
  { id:"PK-10480", customer:"Bancale Trading", docs:3, status:"Validated", confidence:98, received:"16 Sep 2026, 15:31", ticket:"TK-88419" },
  { id:"PK-10479", customer:"Raven Industrial", docs:5, status:"Needs review", confidence:88, received:"16 Sep 2026, 15:12", ticket:"TK-88418" }
];

const customers = [
  {name:"Acme Components Ltd", code:"ACME-001", mailbox:"customs.acme@inbox.example", rules:12, processed:"2,481"},
  {name:"Northstar Manufacturing", code:"NSTM-014", mailbox:"customs.northstar@inbox.example", rules:8, processed:"1,972"},
  {name:"Bancale Trading", code:"BANC-007", mailbox:"customs.bancale@inbox.example", rules:15, processed:"3,108"},
  {name:"Raven Industrial", code:"RAVN-021", mailbox:"customs.raven@inbox.example", rules:6, processed:"1,406"}
];

const DOC_DB_NAME="customs-idp-documents";
const DOC_STORE="files";
function openDocDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DOC_DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DOC_STORE))req.result.createObjectStore(DOC_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function saveUploadedDocument(id,file){const db=await openDocDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DOC_STORE,"readwrite");tx.objectStore(DOC_STORE).put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function getUploadedDocument(id){const db=await openDocDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DOC_STORE,"readonly");const req=tx.objectStore(DOC_STORE).get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}

const sampleLines = [
  {line:1,description:"Oak wooden packaging boxes",hs:"4415 10 00",origin:"HU",qty:24,net:"10.080",gross:"11.420",value:"384.00",confidence:97},
  {line:2,description:"Bancale Legno pallets",hs:"4415 20 90",origin:"IT",qty:6,net:"0.000",gross:"3.180",value:"120.00",confidence:93},
  {line:3,description:"Protective timber spacers",hs:"4415 10 90",origin:"HU",qty:18,net:"7.560",gross:"8.410",value:"216.00",confidence:94}
];

const TEST_USERS=[
  {id:"liam",name:"Liam Wingrove",role:"manager",initials:"LW"},
  {id:"muhammad",name:"Muhammad Amer",role:"manager",initials:"MA"},
  {id:"processor1",name:"Data Processor 1",role:"user",initials:"P1"},
  {id:"processor2",name:"Data Processor 2",role:"user",initials:"P2"}
];

function TestUserLogin({onSelect}){
  return <div className="test-login">
    <div className="test-login-card">
      <div className="test-login-brand"><div className="brand-mark"><Zap size={18}/></div><div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div>
      <div className="test-login-copy"><div className="eyebrow">Test environment</div><h1>Select user</h1><p>No email or password is required. Choose the test user you want to work as.</p></div>
      <div className="test-user-list">
        {TEST_USERS.map(user=><button className="test-user-button" key={user.id} onClick={()=>onSelect(user)}>
          <span className="test-user-avatar">{user.initials}</span>
          <span><b>{user.name}</b><small>{user.role==="manager"?"Manager":"Data Processor"}</small></span>
          <ArrowRight size={16}/>
        </button>)}
      </div>
    </div>
  </div>;
}

function App(){
  const [currentUser,setCurrentUser]=useState(()=>{
    try{
      const saved=localStorage.getItem("customs-idp-user");
      return TEST_USERS.find(u=>u.id===saved)||null;
    }catch{return null;}
  });
  const [page,setPage]=useState("inbox");
  const [selectedPack,setSelectedPack]=useState(packs[0]);
  const [agentOpen,setAgentOpen]=useState(true);
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const currentUserRole=currentUser?.role||"";
  const currentUserName=currentUser?.name||"";
  const currentUserInitials=currentUser?.initials||"";
  const canViewManager=currentUserRole==="manager" || currentUserRole==="admin";
  const [query,setQuery]=useState("");
  const [toast,setToast]=useState("");
  const [livePacks,setLivePacks]=useState(()=>{
    try { const saved=localStorage.getItem("customs-idp-packs"); return saved ? JSON.parse(saved) : packs; }
    catch { return packs; }
  });
  const [dataSource,setDataSource]=useState("local");
  useEffect(()=>{
    let active=true;
    (async()=>{
      try {
        const response=await fetch("/api/packs");
        if(!response.ok) throw new Error("Database unavailable");
        const data=await response.json();
        if(active && Array.isArray(data.packs)){
  if(data.packs.length){
    // Keep browser-stored document metadata when older database rows pre-date
    // persistent uploadedFiles support, and prefer database metadata once present.
    const localPackMap=new Map((livePacks||[]).map(pack=>[pack.id,pack]));
    let nextPacks=data.packs.map(pack=>{
      const local=localPackMap.get(pack.id);
      return pack.uploadedFiles?.length ? pack : (local?.uploadedFiles?.length ? {...pack,uploadedFiles:local.uploadedFiles} : pack);
    });
    try{
      const resetKey="customs-idp-inbox-reset-v2";
      if(!localStorage.getItem(resetKey)){
        nextPacks=nextPacks.map(pack=>({
          ...pack,
          status:pack.status==="Validated"||pack.status==="Posted to LCA"?"Needs review":pack.status,
          processingCompletedAt:undefined,
          validationStatus:undefined,
          validationChecks:undefined,
          postedToLCAAt:undefined
        }));
        await Promise.all(nextPacks.map(pack=>fetch("/api/packs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pack)})));
        localStorage.setItem(resetKey,"1");
      }
    }catch{}
    setLivePacks(nextPacks);
    // Backfill document metadata to Supabase for packs restored from local browser storage.
    const restoredWithDocuments=nextPacks.filter(pack=>{
      const local=localPackMap.get(pack.id);
      return !data.packs.find(dbPack=>dbPack.id===pack.id)?.uploadedFiles?.length && local?.uploadedFiles?.length;
    });
    if(restoredWithDocuments.length){
      await Promise.all(restoredWithDocuments.map(pack=>fetch("/api/packs",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(pack)
      })));
    }
  } else if(livePacks.length){
    await Promise.all(livePacks.map(pack=>fetch("/api/packs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pack)})));
  }
  setDataSource("database");
}
      } catch { /* keep local prototype data until database credentials are configured */ }
    })();
    return()=>{active=false;};
  },[]);
  useEffect(()=>{ try { localStorage.setItem("customs-idp-packs",JSON.stringify(livePacks)); } catch {} },[livePacks]);
  const persistPack=async(pack)=>{
    try{
      const response=await fetch("/api/packs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pack)});
      if(!response.ok) throw new Error("Database save failed");
      setDataSource("database");
      return true;
    }catch{return false;}
  };
  const uploadRef=useRef(null);
  const reprocessPack=async(pack)=>{
    if(!pack)return;
    const files=pack.uploadedFiles||[];
    if(!files.length){notify("No uploaded documents are available to reprocess");return;}
    const processing={...pack,status:"Processing",processingError:undefined,validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
    setSelectedPack(processing);setLivePacks(prev=>prev.map(p=>p.id===pack.id?processing:p));persistPack(processing);notify("Re-processing all documents — AI extraction started");
    try{
      const extractedDocuments=[];
      for(const uploaded of files){
        let source=null;
        if(uploaded.storagePath){const sr=await fetch("/api/storage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"signed-url",path:uploaded.storagePath})});const sd=await sr.json();if(!sr.ok)throw new Error(sd.error||"Stored document could not be opened");const fr=await fetch(sd.signedUrl);if(!fr.ok)throw new Error("Stored document could not be downloaded");source=await fr.blob();}else source=await getUploadedDocument(uploaded.id);
        if(!source)throw new Error("Uploaded document is unavailable: "+uploaded.name);
        const bytes=new Uint8Array(await source.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
        const response=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileData:"data:"+(source.type||uploaded.type||"application/octet-stream")+";base64,"+btoa(binary),filename:uploaded.name,mimeType:source.type||uploaded.type})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||("Extraction failed for "+uploaded.name));
        extractedDocuments.push({id:uploaded.id,filename:uploaded.name,mimeType:source.type||uploaded.type,extraction:result.extraction});
      }
      const confidences=extractedDocuments.map(d=>Number(d.extraction?.confidence)||0).filter(Boolean);
      const primaryDoc=extractedDocuments.find(d=>d.extraction?.documentType==="commercial_invoice")||extractedDocuments[0];
      const processed={...processing,status:"Needs review",confidence:confidences.length?Math.round(confidences.reduce((a,b)=>a+b,0)/confidences.length*100):0,extractedData:{...(primaryDoc?.extraction||{}),documents:extractedDocuments,documentCount:extractedDocuments.length,sourceDocuments:extractedDocuments.map(d=>({id:d.id,filename:d.filename,mimeType:d.mimeType,documentType:d.extraction?.documentType||"unknown",confidence:d.extraction?.confidence||0})),agentMessages:[],extractionRunId:new Date().toISOString()}};
      setSelectedPack(processed);setLivePacks(prev=>prev.map(p=>p.id===processed.id?processed:p));persistPack(processed);notify("Re-processing complete — "+extractedDocuments.length+" documents extracted");
    }catch(error){const failed={...processing,status:"Needs review",processingError:error.message};setSelectedPack(failed);setLivePacks(prev=>prev.map(p=>p.id===failed.id?failed:p));persistPack(failed);notify("Re-processing failed — check the pack for details");}
  };

  const handleUpload=async(files)=>{
    const selected=Array.from(files||[]);
    if(!selected.length) return;
    const file=selected[0];
    const highest=livePacks.reduce((max,p)=>Math.max(max,Number(String(p.id||"").replace("PK-",""))||0),10482);
    const id=`PK-${highest+1}`;
    const processingStartedAt=new Date().toISOString();
    let uploadedFiles;
    try{
      uploadedFiles=await Promise.all(selected.map(async(f,index)=>{
        const localId=`${id}-${index}`;
        await saveUploadedDocument(localId,f);
        const storageResponse=await fetch("/api/storage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"upload-url",packId:id,filename:f.name,contentType:f.type})});
        const storageData=await storageResponse.json();
        if(!storageResponse.ok) throw new Error(storageData.error||"Could not create storage upload URL");
        const uploadResponse=await fetch(storageData.signedUrl,{method:"PUT",headers:{"Content-Type":f.type||"application/octet-stream"},body:f});
        if(!uploadResponse.ok) throw new Error(`Could not upload ${f.name} to document storage`);
        return {id:localId,name:f.name,size:f.size,type:f.type,storagePath:storageData.path};
      }));
    }catch(error){
      notify(`Document storage upload failed: ${error.message}`);
      return;
    }
    const newPack={id,customer:"Unassigned customer",docs:selected.length,status:"Processing",confidence:0,received:processingStartedAt,processingStartedAt,ticket:`UPLOAD-${Date.now().toString().slice(-5)}`,assignedTo:"Unassigned",uploadedFiles};
    setLivePacks(prev=>[newPack,...prev]);
    persistPack(newPack);
    setSelectedPack(newPack);
    navigate("review");
    notify("Document uploaded — AI extraction started");
    try {
      const extractedDocuments=[];
      for(const uploaded of uploadedFiles){
        let source=null;
        const original=selected.find(f=>f.name===uploaded.name && f.size===uploaded.size) || selected.find(f=>f.name===uploaded.name);
        if(original){
          source=original;
        }else if(uploaded.storagePath){
          const storageResponse=await fetch("/api/storage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"signed-url",path:uploaded.storagePath})});
          const storageData=await storageResponse.json();
          if(!storageResponse.ok) throw new Error(storageData.error||`Could not open ${uploaded.name}`);
          const fileResponse=await fetch(storageData.signedUrl);
          if(!fileResponse.ok) throw new Error(`Could not download ${uploaded.name}`);
          source=await fileResponse.blob();
        }
        if(!source) throw new Error(`Document ${uploaded.name} is unavailable`);
        const buffer=await source.arrayBuffer();
        const bytes=new Uint8Array(buffer);
        let binary="";
        const chunk=0x8000;
        for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
        const dataUrl=`data:${source.type || uploaded.type || "application/octet-stream"};base64,${btoa(binary)}`;
        const response=await fetch("/api/extract",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({fileData:dataUrl,filename:uploaded.name,mimeType:source.type || uploaded.type})
        });
        const result=await response.json();
        if(!response.ok) throw new Error(result.error || `Extraction failed for ${uploaded.name}`);
        extractedDocuments.push({
          id:uploaded.id,
          filename:uploaded.name,
          mimeType:source.type || uploaded.type,
          extraction:result.extraction
        });
      }
      const confidences=extractedDocuments.map(d=>Number(d.extraction?.confidence)||0).filter(v=>v>0);
      const firstInvoice=extractedDocuments.find(d=>d.extraction?.documentType==="commercial_invoice") || extractedDocuments[0];
      const primary=firstInvoice?.extraction||{};
      const processed={
        ...newPack,
        status:"Needs review",
        confidence:confidences.length?Math.round((confidences.reduce((a,b)=>a+b,0)/confidences.length)*100):0,
        extractedData:{
          ...primary,
          documents:extractedDocuments,
          documentCount:extractedDocuments.length,
          sourceDocuments:extractedDocuments.map(d=>({id:d.id,filename:d.filename,mimeType:d.mimeType,documentType:d.extraction?.documentType||"unknown",confidence:d.extraction?.confidence||0}))
        }
      };
      setSelectedPack(processed);
      setLivePacks(prev=>prev.map(p=>p.id===id?processed:p));
      persistPack(processed);
      notify(`${extractedDocuments.length} document${extractedDocuments.length===1?"":"s"} extracted successfully`);
    } catch(error) {
      const failed={...newPack,status:"Needs review",processingError:error.message};
      setSelectedPack(failed);
      setLivePacks(prev=>prev.map(p=>p.id===id?failed:p));
      persistPack(failed);
      notify("Extraction failed — check the pack for details");
    }
  };

  const filteredPacks=useMemo(()=>livePacks.filter(p=>
    [p.id,p.customer,p.status,p.ticket].join(" ").toLowerCase().includes(query.toLowerCase())
  ),[livePacks,query]);

  const navigate=(p)=>{setPage(p);setMobileMenuOpen(false);};
  const notify=(msg)=>{setToast(msg);setTimeout(()=>setToast(""),2500)};
  const assignPack=(packId,assignedTo)=>{const updated={...livePacks.find(p=>p.id===packId),assignedTo};setLivePacks(prev=>prev.map(p=>p.id===packId?updated:p));if(selectedPack?.id===packId)setSelectedPack(prev=>({...prev,assignedTo}));persistPack(updated);notify(`Pack ${packId} assigned to ${assignedTo}`)};
  const updatePack=(pack)=>{
    if(!pack)return;
    setSelectedPack(pack);
    setLivePacks(prev=>prev.map(p=>p.id===pack.id?pack:p));
    persistPack(pack);
  };
  const validatePack=()=>{
  if(!selectedPack)return;
  const data=selectedPack.extractedData||{};
  const lines=data.lines||[];
  const checks=[];
  const exportCountry=String(data.countryOfExport||"").trim().toUpperCase();
  const exporterAddress=String(data.exporterAddress||"").trim();
  const exporterEori=String(data.exporterEoriNo||"").trim();
  const exporterCountryIso=String(data.exporterCountryIso||"").trim().toUpperCase();
  const isGBExporter=exportCountry==="GB" || exporterCountryIso==="GB" || /(?:^|[\\n, ])(?:GB|UK|UNITED KINGDOM)(?:$|[\\n, ])/i.test(exporterAddress);
  const exporterAddressLine1=String(data.exporterAddressLine1||"").trim();
  const exporterPostcode=String(data.exporterPostcode||"").trim();
  const exporterCity=String(data.exporterCity||"").trim();
  const exporterCountryIsoForCheck=String(data.exporterCountryIso||"").trim();
  const addressChecks=[
    ["Exporter address line 1",exporterAddressLine1],
    ["Exporter postcode/ZIP",exporterPostcode],
    ["Exporter city",exporterCity],
    ["Exporter country ISO",exporterCountryIsoForCheck]
  ];
  addressChecks.forEach(([check,value])=>{
    checks.push({
      check,
      status:value?"pass":"fail",
      detail:value?check+" extracted: "+value:check+" is missing from the extracted data. Check the source document and correct the pack before posting to LCA."
    });
  });
  if(isGBExporter){
    checks.push({
      check:"GB exporter EORI",
      status:exporterEori?"pass":"fail",
      detail:exporterEori
        ?"Exporter EORI extracted: "+exporterEori
        :"GB exporter address/export country detected but no EORI number was extracted. Check the source document and correct the pack before posting to LCA."
    });
  }else{
    checks.push({check:"GB exporter EORI",status:"not_applicable",detail:"Exporter is not identified as GB."});
  }
  lines.forEach((line,index)=>{
    checks.push({
      lineNo:line.lineNo||index+1,
      check:"Line "+(line.lineNo||index+1)+" extraction",
      status:"pass",
      message:"Source data extracted."
    });
  });
  const weightDecision=data.weightSourceDecision;
  if(weightDecision){
    checks.push({
      check:"Weight source comparison",
      status:"warning",
      detail:"A cross-document weight issue remains recorded. "+(weightDecision.source==="packing_list"?"Packing List":"Commercial Invoice")+" was selected for "+(Number(weightDecision.matchedLines)||0)+" matched line(s); review the document source difference before declaration."
    });
  }
  const hasFail=checks.some(x=>x.status==="fail");
  const validated={
    ...selectedPack,
    status:hasFail?"Needs review":"Ready",
    validationStatus:hasFail?"Failed":"Validated",
    validationChecks:checks
  };
  setSelectedPack(validated);
  setLivePacks(prev=>prev.map(p=>p.id===validated.id?validated:p));
  persistPack(validated);
  notify(hasFail
    ?"Validation failed — "+checks.filter(x=>x.status==="fail").map(x=>x.check).join(", ")
    :"Data validation complete — all implemented checks passed");
};
const postToLCA=()=>{
  if(!selectedPack)return;
  if(selectedPack.validationStatus!=="Validated" || selectedPack.status!=="Ready"){
    notify("Validate the extracted data before posting to LCA");
    return;
  }
  const now=new Date().toISOString();
  const assignedTo=selectedPack.assignedTo&&selectedPack.assignedTo!=="Unassigned"?selectedPack.assignedTo:currentUserName;
  const posted={...selectedPack,status:"Posted to LCA",assignedTo,processingCompletedAt:selectedPack.processingCompletedAt||now,postedToLCAAt:now};
  setSelectedPack(posted);
  setLivePacks(prev=>prev.map(p=>p.id===posted.id?posted:p));
  persistPack(posted);
  notify("Pack posted to LCA");
  navigate("inbox");
};

  if(!currentUser)return <TestUserLogin onSelect={user=>{
    setCurrentUser(user);
    try{localStorage.setItem("customs-idp-user",user.id);}catch{}
    setPage("inbox");
  }}/>;

  return <div className={"app-shell "+(sidebarCollapsed?"sidebar-collapsed":"")}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Zap size={18}/></div><div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div>
      <div className="workspace"><div className="avatar">{currentUserInitials}</div><div><b>{currentUserName}</b><span>{currentUserRole==="manager"?"Manager":"Data Processor"} · {dataSource==="database"?"Database connected":"Prototype storage"}</span></div></div>
      <nav>
        <NavItem icon={Inbox} label="Inbox" badge={livePacks.length} active={page==="inbox"} onClick={()=>navigate("inbox")}/>
        {canViewManager && <NavItem icon={Activity} label="Manager" active={page==="manager"} onClick={()=>navigate("manager")}/>}
        <NavItem icon={Users} label="Customers" active={page==="customers"} onClick={()=>navigate("customers")}/>
        <NavItem icon={Bot} label="AI Agent" active={page==="agent"} onClick={()=>navigate("agent")}/>
      </nav>
      <div className="side-bottom">
        <NavItem icon={Settings} label="Settings" active={page==="settings"} onClick={()=>navigate("settings")}/>
        <button className="switch-user-btn" onClick={()=>{setCurrentUser(null);try{localStorage.removeItem("customs-idp-user");}catch{};setPage("inbox")}}><Users size={16}/><span>Switch user</span></button>
        <div className="system-status"><span className="dot"></span><div><b>All systems operational</b><span>Last sync 16:02</span></div></div>
      </div>
    </aside>
    <button className="sidebar-collapse-btn" aria-label={sidebarCollapsed?"Expand sidebar":"Collapse sidebar"} onClick={()=>setSidebarCollapsed(v=>!v)}>{sidebarCollapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>

    {mobileMenuOpen && <div className="mobile-menu-overlay" onClick={()=>setMobileMenuOpen(false)}><aside className="mobile-menu" onClick={e=>e.stopPropagation()}><div className="mobile-menu-head"><div className="brand"><div className="brand-mark"><Zap size={18}/></div><div><strong>Customs IDP</strong><span>Intelligent Data Processing</span></div></div><button className="icon-btn" aria-label="Close navigation" onClick={()=>setMobileMenuOpen(false)}><X size={20}/></button></div><div className="mobile-workspace"><div className="avatar">{currentUserInitials}</div><div><b>{currentUserName}</b><span>{currentUserRole==="manager"?"Manager":"Data Processor"} · {dataSource==="database"?"Database connected":"Prototype storage"}</span></div></div><nav><NavItem icon={Inbox} label="Inbox" badge={livePacks.length} active={page==="inbox"} onClick={()=>navigate("inbox")}/>{canViewManager && <NavItem icon={Activity} label="Manager" active={page==="manager"} onClick={()=>navigate("manager")}/>}<NavItem icon={Users} label="Customers" active={page==="customers"} onClick={()=>navigate("customers")}/><NavItem icon={Bot} label="AI Agent" active={page==="agent"} onClick={()=>navigate("agent")}/><NavItem icon={Settings} label="Settings" active={page==="settings"} onClick={()=>navigate("settings")}/></nav><button className="switch-user-btn mobile-switch-user" onClick={()=>{setCurrentUser(null);try{localStorage.removeItem("customs-idp-user");}catch{};setPage("inbox")}}><Users size={16}/><span>Switch user</span></button><div className="mobile-system-status"><span className="dot"></span><div><b>All systems operational</b><span>Last sync 16:02</span></div></div></aside></div>}

    <main className="main">
      <header className="topbar">
        <button className="mobile-menu-btn" aria-label="Open navigation" onClick={()=>setMobileMenuOpen(true)}><Menu size={20}/></button><div className="mobile-brand"><strong>Customs IDP</strong></div>
        <div className="crumb">Operations <span>/</span> {page[0].toUpperCase()+page.slice(1)}</div>
        <div className="top-actions"><button className="icon-btn" aria-label="Open inbox" onClick={()=>navigate("inbox")}><Mail size={18}/></button><div className="top-avatar" title={currentUserName}>{currentUserInitials}</div></div>
      </header>

      <input ref={uploadRef} className="hidden-upload" type="file" multiple accept=".pdf,.xlsx,.xls,.doc,.docx,.csv,.png,.jpg,.jpeg,.eml,.msg" onChange={e=>handleUpload(e.target.files)}/>
      <div className="content">
        {page==="manager" && canViewManager && <ManagerPage livePacks={livePacks} dataSource={dataSource}/>} 
        {page==="dashboard" && <Dashboard navigate={navigate} notify={notify} livePacks={livePacks}/>}
        {page==="inbox" && <InboxPage packs={filteredPacks} query={query} setQuery={setQuery} openPack={(p)=>{setSelectedPack(p);navigate("review")}} onUpload={handleUpload} onAssign={assignPack}/>}
        
        {page==="review" && <Review pack={selectedPack} back={()=>navigate("inbox")} notify={notify} onAssign={assignPack} updatePack={updatePack} validatePack={validatePack} postToLCA={postToLCA} reprocessPack={reprocessPack}/>}
        {page==="customers" && <Customers notify={notify}/>}
        {page==="agent" && <AgentPage/>}
        {page==="settings" && <SettingsPage/>}
      </div>
    </main>

    {agentOpen && page!=="agent" && <button className="agent-fab" onClick={()=>navigate("agent")}><Sparkles size={18}/> AI Agent</button>}
    {toast && <div className="toast"><CheckCircle2 size={17}/>{toast}</div>}
  </div>
}

function NavItem({icon:Icon,label,badge,active,onClick}){return <button className={"nav-item "+(active?"active":"")} onClick={onClick}><Icon size={18}/><span>{label}</span>{badge&&<em>{badge}</em>}</button>}

function Dashboard({navigate,notify,livePacks}){
 const totalPacks=livePacks.length;
 const totalDocuments=livePacks.reduce((n,p)=>n+(Number(p.docs)||0),0);
 const validated=livePacks.filter(p=>p.status==="Validated").length;
 const processing=livePacks.filter(p=>p.status==="Processing").length;
 const review=livePacks.filter(p=>p.status==="Needs review").length;
 const avgConfidence=totalPacks?Math.round(livePacks.reduce((n,p)=>n+(Number(p.confidence)||0),0)/totalPacks):0;
 const validationRate=totalPacks?((validated/totalPacks)*100).toFixed(1):"0.0";
 const recent=livePacks.slice(0,6);
 return <section>
  <div className="page-head"><div><div className="eyebrow">Live operation · {new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}</div><h1>{new Date().getHours()<12?"Good morning":new Date().getHours()<18?"Good afternoon":"Good evening"}, Liam</h1><p>Live metrics from the packs currently loaded into Customs IDP.</p></div><button className="primary" onClick={()=>navigate("inbox")}><Inbox size={17}/> Open inbox</button></div>
  <div className="metric-grid">
    <Metric label="Live packs" value={totalPacks.toLocaleString()} delta="Current inbox" icon={Package}/>
    <Metric label="Documents in packs" value={totalDocuments.toLocaleString()} delta="Current inbox" icon={FileText}/>
    <Metric label="Auto-validated" value={validationRate+"%"} delta={validated+" validated"} icon={ShieldCheck}/>
    <Metric label="Needs review" value={review.toLocaleString()} delta={processing+" processing"} icon={AlertCircle} warning={review>0}/>
  </div>
  <div className="dashboard-grid">
    <div className="panel"><div className="panel-head"><div><h2>Live processing queue</h2><p>Current status of every pack in the inbox</p></div><button className="text-btn" onClick={()=>navigate("inbox")}>Open inbox <ArrowRight size={15}/></button></div><div className="queue-list"><Queue label="Validated" value={validated} pct={validationRate} cls="good"/><Queue label="Processing" value={processing} pct={totalPacks?((processing/totalPacks)*100).toFixed(1):"0.0"} cls="blue"/><Queue label="Needs review" value={review} pct={totalPacks?((review/totalPacks)*100).toFixed(1):"0.0"} cls="warn"/></div></div>
    <div className="panel"><div className="panel-head"><div><h2>Extraction health</h2><p>Based on live packs currently loaded</p></div></div><div className="queue-list"><Queue label="Average confidence" value={avgConfidence+"%"} pct={avgConfidence} cls="good"/><Queue label="Documents" value={totalDocuments} pct={100} cls="blue"/><Queue label="Packs requiring attention" value={review} pct={totalPacks?((review/totalPacks)*100).toFixed(1):"0.0"} cls="warn"/></div><button className="text-btn" onClick={()=>navigate("agent")}>Open AI Agent <ArrowRight size={15}/></button></div>
  </div>
  <div className="panel recent"><div className="panel-head"><div><h2>Recent live packs</h2><p>Latest packs currently in the operation</p></div><button className="text-btn" onClick={()=>navigate("inbox")}>View inbox <ArrowRight size={15}/></button></div><PackTable packs={recent} onOpen={(p)=>{navigate("inbox")}}/></div>
 </section>
}

function ManagerPage({livePacks,dataSource}){
 const [period,setPeriod]=useState("7d");
 const [customFrom,setCustomFrom]=useState("");
 const [customTo,setCustomTo]=useState("");
 const [appliedFrom,setAppliedFrom]=useState("");
 const [appliedTo,setAppliedTo]=useState("");
 const now=new Date();
 const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 let rangeStart=null,rangeEnd=null;
 if(period==="today"){rangeStart=today;rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="yesterday"){rangeStart=new Date(today.getTime()-86400000);rangeEnd=new Date(today.getTime()-1);}
 if(period==="7d"){rangeStart=new Date(today.getTime()-6*86400000);rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="30d"){rangeStart=new Date(today.getTime()-29*86400000);rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="thisMonth"){rangeStart=new Date(today.getFullYear(),today.getMonth(),1);rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="lastMonth"){rangeStart=new Date(today.getFullYear(),today.getMonth()-1,1);rangeEnd=new Date(today.getFullYear(),today.getMonth(),1)-1;rangeEnd=new Date(rangeEnd);}
 if(period==="thisWeek"){const day=today.getDay()||7;rangeStart=new Date(today.getTime()-(day-1)*86400000);rangeEnd=new Date(today.getTime()+86400000-1);}
 if(period==="lastWeek"){const day=today.getDay()||7;rangeStart=new Date(today.getTime()-(day+6)*86400000);rangeEnd=new Date(today.getTime()-(day-1)*86400000-1);}
 if(period==="custom" && appliedFrom){rangeStart=new Date(appliedFrom+"T00:00:00");rangeEnd=appliedTo?new Date(appliedTo+"T23:59:59.999"):new Date(appliedFrom+"T23:59:59.999");}
 const filtered=livePacks.filter(p=>{
   if(!rangeStart)return true;
   const received=new Date(p.received);
   return !Number.isNaN(received.getTime()) && received>=rangeStart && received<=rangeEnd;
 });
 const totalPacks=filtered.length;
 const totalDocuments=filtered.reduce((n,p)=>n+(Number(p.docs)||0),0);
 const validated=filtered.filter(p=>p.status==="Ready"||p.status==="Validated"||p.status==="Posted to LCA").length;
 const review=filtered.filter(p=>p.status==="Needs review").length;
 const processing=filtered.filter(p=>p.status==="Processing").length;
 const failed=filtered.filter(p=>p.status==="Failed"||p.status==="failed").length;
 const avgConfidence=totalPacks?Math.round(filtered.reduce((n,p)=>n+(Number(p.confidence)||0),0)/totalPacks):0;
 const validationRate=totalPacks?((validated/totalPacks)*100).toFixed(1):"0.0";
 const reviewRate=totalPacks?((review/totalPacks)*100).toFixed(1):"0.0";
 const failureRate=totalPacks?((failed/totalPacks)*100).toFixed(1):"0.0";
 const periodLabel={today:"Today",yesterday:"Yesterday","7d":"Last 7 days","30d":"Last 30 days",thisWeek:"This week",lastWeek:"Last week",thisMonth:"This month",lastMonth:"Last month",all:"All time",custom:"Custom range"}[period];
 const formatDuration=(ms)=>{if(!Number.isFinite(ms)||ms<0)return "—";const mins=Math.round(ms/60000);if(mins<60)return mins+" min";const h=Math.floor(mins/60);const m=mins%60;return h+"h "+String(m).padStart(2,"0")+"m"};
 const team=["Liam Wingrove","Data Processor 1","Data Processor 2","Muhammad Amer"].map(name=>{
   const rows=filtered.filter(p=>p.assignedTo===name);
   const docs=rows.reduce((n,p)=>n+(Number(p.docs)||0),0);
   const reviews=rows.filter(p=>p.status==="Needs review").length;
   const validatedBy=rows.filter(p=>p.status==="Ready"||p.status==="Validated"||p.status==="Posted to LCA").length;
   const timed=rows.filter(p=>p.processingStartedAt&&p.processingCompletedAt).map(p=>new Date(p.processingCompletedAt).getTime()-new Date(p.processingStartedAt).getTime()).filter(ms=>Number.isFinite(ms)&&ms>=0);
   const avgProcessingTime=timed.length?formatDuration(timed.reduce((a,b)=>a+b,0)/timed.length):"—";
   const confidence=rows.length?Math.round(rows.reduce((n,p)=>n+(Number(p.confidence)||0),0)/rows.length)+"%":"—";
   return {name,role:name==="Liam Wingrove"||name==="Muhammad Amer"?"Manager":"Data Processor",packs:rows.length,docs,reviews,validated:validatedBy,confidence,avgProcessingTime};
  });
 const unassigned=filtered.filter(p=>!p.assignedTo||p.assignedTo==="Unassigned").length;
 const customersLive=[...new Set(filtered.map(p=>p.customer).filter(Boolean))];
 return <section>
  <div className="page-head">
   <div><div className="eyebrow">Management · operational intelligence</div><h1>Manager</h1><p>Live operational metrics from the central pack database.</p></div>
   <div className="manager-head-actions">
    <span className="online-pill"><span></span>{dataSource==="database"?"Database connected":"Prototype storage"}</span>
    <select className="manager-period-select" value={period} onChange={e=>setPeriod(e.target.value)}>
     <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="thisWeek">This week</option><option value="lastWeek">Last week</option><option value="thisMonth">This month</option><option value="lastMonth">Last month</option><option value="all">All time</option><option value="custom">Custom range</option>
    </select>
    {period==="custom" && <div className="manager-custom-range"><label>From<input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}/></label><label>To<input type="date" value={customTo} min={customFrom||undefined} onChange={e=>setCustomTo(e.target.value)}/></label><button type="button" className="manager-apply-range" disabled={!customFrom} onClick={()=>{setAppliedFrom(customFrom);setAppliedTo(customTo||customFrom);}}>Apply</button></div>}
   </div>
  </div>
  <div className="metric-grid">
   <Metric label="Packs processed" value={totalPacks.toLocaleString()} delta={validated+" validated"} icon={Package}/>
   <Metric label="Documents processed" value={totalDocuments.toLocaleString()} delta={periodLabel} icon={FileText}/>
   <Metric label="Average AI confidence" value={avgConfidence+"%"} delta={totalPacks?periodLabel:"No packs in period"} icon={Sparkles}/>
   <Metric label="Human review queue" value={review.toLocaleString()} delta={processing+" still processing"} icon={AlertCircle} warning={review>0}/>
  </div>
  <div className="manager-kpi-grid">
   <div className="panel mini-kpi"><span>Auto-validation rate</span><strong>{validationRate}%</strong><small>{validated} of {totalPacks} packs validated</small></div>
   <div className="panel mini-kpi"><span>Human review rate</span><strong>{reviewRate}%</strong><small>{review} packs require review</small></div>
   <div className="panel mini-kpi"><span>Failure rate</span><strong>{failureRate}%</strong><small>{failed} failed packs</small></div>
   <div className="panel mini-kpi"><span>Documents / pack</span><strong>{totalPacks?(totalDocuments/totalPacks).toFixed(1):"0.0"}</strong><small>Average in selected period</small></div>
  </div>
  <div className="manager-grid">
   <div className="panel">
    <div className="panel-head"><div><h2>Team performance</h2><p>{periodLabel} · based on pack ownership</p></div></div>
    <div className="manager-table-wrap"><table><thead><tr><th>TEAM MEMBER</th><th>ROLE</th><th>PACKS</th><th>DOCUMENTS</th><th>VALIDATED</th><th>REVIEWS</th><th>AVG CONF.</th><th>AVG PROCESSING</th></tr></thead><tbody>{team.map(m=><tr key={m.name}><td><b>{m.name}</b></td><td>{m.role}</td><td>{m.packs}</td><td>{m.docs}</td><td>{m.validated}</td><td>{m.reviews}</td><td>{m.confidence}</td><td>{m.avgProcessingTime}</td></tr>)}</tbody></table></div>
    <div className="manager-note"><ShieldCheck size={15}/><span>{unassigned?unassigned+" pack"+(unassigned===1?" is":"s are")+" currently unassigned in this period.":"All packs in this period have an owner."} Assign ownership from Inbox to populate team performance.</span></div>
   </div>
   <div className="panel"><div className="panel-head"><div><h2>Platform health</h2><p>{periodLabel} workload across the operation</p></div></div><div className="queue-list"><Queue label="Validated" value={validated} pct={totalPacks?((validated/totalPacks)*100).toFixed(1):"0.0"} cls="good"/><Queue label="Processing" value={processing} pct={totalPacks?((processing/totalPacks)*100).toFixed(1):"0.0"} cls="blue"/><Queue label="Needs review" value={review} pct={totalPacks?((review/totalPacks)*100).toFixed(1):"0.0"} cls="warn"/></div></div>
  </div>
  <div className="panel manager-section">
   <div className="panel-head"><div><h2>Customer workload</h2><p>{periodLabel} customer activity</p></div></div>
   <div className="manager-customer-grid">
    {customersLive.length?customersLive.map(name=>{
      const rows=filtered.filter(p=>p.customer===name);
      const docs=rows.reduce((n,p)=>n+(Number(p.docs)||0),0);
      const needs=rows.filter(p=>p.status==="Needs review").length;
      const avg=rows.length?Math.round(rows.reduce((n,p)=>n+(Number(p.confidence)||0),0)/rows.length):0;
      return <div className="manager-customer" key={name}><b>{name}</b><span>{rows.length} packs · {docs} documents</span><small>{needs} requiring review · {avg}% avg confidence</small></div>;
    }):<div className="manager-empty">No customer activity is recorded for {periodLabel.toLowerCase()}.</div>}
   </div>
  </div>
  <div className="manager-section-head"><div><h2>Management controls</h2><p>Operational controls connected to the central database.</p></div></div>
  <div className="manager-control-grid">
   <div className="panel manager-control"><Activity size={18}/><div><b>Processing analytics</b><span>{totalPacks} packs and {totalDocuments} documents in {periodLabel.toLowerCase()}.</span></div></div>
   <div className="panel manager-control"><Users size={18}/><div><b>Team allocation</b><span>Assign pack ownership from the Inbox owner column.</span></div></div>
   <div className="panel manager-control"><ShieldCheck size={18}/><div><b>Quality & intervention</b><span>{review} packs currently require human review.</span></div></div>
   <div className="panel manager-control"><FileText size={18}/><div><b>Processing time</b><span>Timing fields will populate once start/completion timestamps are recorded.</span></div></div>
  </div>
 </section>;
}
function Metric({label,value,delta,icon:Icon,warning}){return <div className="metric"><div className={"metric-icon "+(warning?"warning":"")}><Icon size={19}/></div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small className={delta.startsWith("-")?"positive":""}>{delta}</small></div></div>}
function Queue({label,value,pct,cls}){return <div className="queue"><div><span className={"queue-dot "+cls}></span><b>{label}</b><strong>{value}</strong></div><div className="progress"><i className={cls} style={{width:pct+"%"}}></i></div><small>{pct}%</small></div>}

function InboxPage({packs,query,setQuery,openPack,title="Inbox",onUpload,onAssign}){
 return <section><div className="page-head"><div><div className="eyebrow">Document processing</div><h1>{title}</h1><p>Review incoming document packs, extraction confidence and validation status.</p></div><button className="primary" onClick={()=>document.querySelector(".hidden-upload")?.click()}><Plus size={17}/> Upload documents</button></div>
 <div className="toolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search packs, customers or tickets..."/></div><button className="filter">Status <ChevronDown size={15}/></button><button className="filter">Customer <ChevronDown size={15}/></button></div>
 <div className="panel"><PackTable packs={packs} onOpen={openPack} onAssign={onAssign}/></div></section>
}

function PackTable({packs,onOpen,onAssign}){return <div className="table-wrap"><table><thead><tr><th>PACK</th><th>CUSTOMER</th><th>OWNER</th><th>DOCUMENTS</th><th>STATUS</th><th>CONFIDENCE</th><th>RECEIVED</th><th></th></tr></thead><tbody>{packs.map(p=><tr key={p.id} onClick={()=>onOpen(p)}><td><b>{p.id}</b><small>{p.ticket}</small></td><td>{p.customer}</td><td><select className="owner-select" value={p.assignedTo||"Unassigned"} onClick={e=>e.stopPropagation()} onChange={e=>onAssign?.(p.id,e.target.value)}><option>Unassigned</option><option>Liam Wingrove</option><option>Data Processor 1</option><option>Data Processor 2</option><option>Muhammad Amer</option></select></td><td>{p.docs} documents</td><td><Status status={p.status}/></td><td><div className="confidence"><span>{p.confidence}%</span><div><i style={{width:p.confidence+"%"}}></i></div></div></td><td>{p.received}</td><td><button className="row-btn"><MoreHorizontal size={17}/></button></td></tr>)}</tbody></table></div>}
function Status({status}){let c=status==="Validated"?"good":status==="Processing"?"processing":"review";return <span className={"status "+c}><span></span>{status}</span>}

function reconcilePackDocuments(pack){
  const docs=Array.isArray(pack?.extractedData?.documents)?pack.extractedData.documents:[];
  if(docs.length<2) return {status:"not_ready",summary:"At least two extracted documents are required.",checks:[],conflicts:[]};
  const norm=v=>String(v??"").trim().toLowerCase().replace(/\\s+/g," ");
  const checks=[]; const conflicts=[];
  const compare=(label,key)=>{
    const found=docs.map(d=>({name:d.filename,value:d.extraction?.[key]})).filter(x=>x.value!=null&&x.value!=="");
    const unique=[...new Set(found.map(x=>norm(x.value)))];
    if(found.length<2){checks.push({label,status:"not_applicable",detail:"Not enough documents contain this field."});return;}
    if(unique.length===1) checks.push({label,status:"pass",detail:found.map(x=>x.name+": "+x.value).join(" · ")});
    else {checks.push({label,status:"conflict",detail:found.map(x=>x.name+": "+x.value).join(" · ")});conflicts.push({label,values:found});}
  };
  compare("Invoice number","invoiceNumber"); compare("Country of export","countryOfExport"); compare("Destination","sourceCountryOfDestination");
  compare("Total packages","totalPackages"); compare("Total net weight","totalNetWeight"); compare("Total gross weight","totalGrossWeight"); compare("Currency","currency");
  const lineCounts=docs.map(d=>({name:d.filename,count:Array.isArray(d.extraction?.lines)?d.extraction.lines.length:0})).filter(x=>x.count>0);
  if(lineCounts.length>=2){const unique=[...new Set(lineCounts.map(x=>x.count))]; if(unique.length===1) checks.push({label:"Goods line count",status:"pass",detail:lineCounts.map(x=>x.name+": "+x.count).join(" · ")}); else {checks.push({label:"Goods line count",status:"conflict",detail:lineCounts.map(x=>x.name+": "+x.count).join(" · ")});conflicts.push({label:"Goods line count",values:lineCounts});}}
  return {status:conflicts.length?"conflict":"pass",summary:conflicts.length?(conflicts.length+" cross-document conflict"+(conflicts.length===1?"":"s")+" found."):"Extracted document values reconcile with no conflicts detected.",checks,conflicts,documentCount:docs.length};
}

function Review({pack,back,notify,onAssign,updatePack,validatePack,postToLCA,reprocessPack}){
 const [docUrls,setDocUrls]=useState({});
 const [chat,setChat]=useState("");
 const [messages,setMessages]=useState([]);
 const [isSending,setIsSending]=useState(false);
 const [selectedDocumentId,setSelectedDocumentId]=useState(null);
 const [previewPage,setPreviewPage]=useState(1);
 const [showPreview,setShowPreview]=useState(false);

 const [emailDraft,setEmailDraft]=useState(null);

 useEffect(()=>{let active=true;(async()=>{const entries=await Promise.all((pack.uploadedFiles||[]).map(async f=>{try{if(f.storagePath){const response=await fetch("/api/storage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"signed-url",path:f.storagePath})});const data=await response.json();if(response.ok&&data.signedUrl)return [f.id,data.signedUrl];}const file=await getUploadedDocument(f.id);return file?[f.id,URL.createObjectURL(file)]:null;}catch{return null;}}));if(active)setDocUrls(Object.fromEntries(entries.filter(Boolean)));})();return()=>{active=false;};},[pack.id,pack.uploadedFiles]);

 const documentRows=pack.uploadedFiles?.length?pack.uploadedFiles:[
   {id:"sample-1",name:"Commercial Invoice 88421.pdf"},{id:"sample-2",name:"Packing List 88421.pdf"},
   {id:"sample-3",name:"Certificate of Origin.pdf"},{id:"sample-4",name:"Transport Document.pdf"}
 ];
 const extractedDocuments=useMemo(()=>{
   const stored=Array.isArray(pack.extractedData?.documents)?pack.extractedData.documents:[];
   if(stored.length)return stored;
   const primary=pack.extractedData&&Object.keys(pack.extractedData).length?pack.extractedData:null;
   if(!primary)return [];
   const fallbackFile=pack.uploadedFiles?.[0];
   if(!fallbackFile)return [];
   return [{
     id:fallbackFile.id||fallbackFile.name,
     filename:fallbackFile.name,
     mimeType:fallbackFile.type||"application/octet-stream",
     extraction:primary
   }];
 },[pack.id,pack.extractedData,pack.uploadedFiles]);
 const evidenceFor=doc=>{const e=doc?.extraction||{};const all=[...(e.fieldEvidence||[])];(e.lines||[]).forEach(line=>(line.evidence||[]).forEach(x=>all.push(x)));return all;};
 const getEvidence=(doc,fields=[])=>{const ev=evidenceFor(doc);return ev.find(x=>fields.includes(x.field)&&x.page)||ev.find(x=>x.page);};
 const sourceButton=(label,docId,page)=><button type="button" className="source-reference" onClick={()=>{setSelectedDocumentId(docId);setPreviewPage(Number(page)||1);setShowPreview(true);}}>{label}</button>;

 const buildSummary=()=>{
   const docs=extractedDocuments;
   const invoiceDoc=docs.find(d=>d.extraction?.documentType==="commercial_invoice")||docs[0];
   const invoice=invoiceDoc?.extraction||{};
   const value=v=>v===undefined||v===null||v===""?"":String(v);
   const hasValue=v=>v!==undefined&&v!==null&&v!=="";
   if(!docs.length){
     return [{type:"agent",text:pack.processingError?"I couldn't complete the extraction. "+pack.processingError:"I'm waiting for document extraction to finish."}];
   }

   const supportingDocs=docs.filter(d=>d!==invoiceDoc);
   const packingDoc=supportingDocs.find(d=>d.extraction?.documentType==="packing_list")
     ||supportingDocs.find(d=>/packing/i.test(d.filename||""))
     ||supportingDocs[0];
   const sourceFor=doc=>{
     const ev=evidenceFor(doc);
     return ev.find(x=>x.page)?.page||1;
   };
   const lines=Array.isArray(invoice.lines)?invoice.lines:[];
   const sourceLines=Array.isArray(packingDoc?.extraction?.lines)?packingDoc.extraction.lines:[];
   const normaliseMatchValue=v=>String(v||"").trim().toLowerCase().replace(/\\s+/g," ");
   const usedSourceLines=new Set();
   const sourceLineMatches=lines.map(invLine=>{
     const hs=normaliseMatchValue(invLine?.hsCode);
     const description=normaliseMatchValue(invLine?.description);
     const available=sourceLines.map((line,index)=>({line,index})).filter(x=>!usedSourceLines.has(x.index));
     const exact=available.filter(x=>hs&&description&&normaliseMatchValue(x.line?.hsCode)===hs&&normaliseMatchValue(x.line?.description)===description);
     const byHs=available.filter(x=>hs&&normaliseMatchValue(x.line?.hsCode)===hs);
     const byDescription=available.filter(x=>description&&normaliseMatchValue(x.line?.description)===description);
     const candidates=exact.length?exact:byHs.length===1?byHs:byDescription.length===1?byDescription:byHs.length?byHs:byDescription;
     if(candidates.length!==1)return {line:null,ambiguous:candidates.length>1,candidates:candidates.map(x=>x.line),invoice:invLine};
     usedSourceLines.add(candidates[0].index);
     return {line:candidates[0].line,ambiguous:false,invoice:invLine};
   });

   const selectedWeightSource=pack.extractedData?.weightSourceDecision?.source||null;
   const weightMatches=sourceLineMatches.filter(match=>match.line);
   const weightIssues=weightMatches.filter(({invoice:invLine,line:plLine})=>{
     const packingHasWeight=hasValue(plLine.netMassKg)||hasValue(plLine.grossMassKg);
     const invoiceMissingWeight=(!hasValue(invLine.netMassKg)&&hasValue(plLine.netMassKg))||(!hasValue(invLine.grossMassKg)&&hasValue(plLine.grossMassKg));
     const weightsDiffer=(hasValue(invLine.netMassKg)&&hasValue(plLine.netMassKg)&&String(invLine.netMassKg)!==String(plLine.netMassKg))
       ||(hasValue(invLine.grossMassKg)&&hasValue(plLine.grossMassKg)&&String(invLine.grossMassKg)!==String(plLine.grossMassKg));
     return packingHasWeight&&(invoiceMissingWeight||weightsDiffer);
   }).map(match=>({...match,doc:packingDoc}));
   const ambiguousWeightIssues=sourceLineMatches.filter(match=>match.ambiguous&&match.candidates.some(line=>hasValue(line.netMassKg)||hasValue(line.grossMassKg))).map(match=>({...match,line:null,doc:packingDoc,ambiguous:true}));
   const reconciliationIssues=[...weightIssues,...ambiguousWeightIssues];
   const packingListHasWeights=weightMatches.some(({line})=>hasValue(line.netMassKg)||hasValue(line.grossMassKg));
   const invoiceHasWeights=lines.some(line=>hasValue(line.netMassKg)||hasValue(line.grossMassKg));
   const weightsNeedDecision=reconciliationIssues.length>0;
   const customsLines=lines.map((line,index)=>{
     const plLine=sourceLineMatches[index]?.line||null;
     const workingNet=selectedWeightSource==="packing_list"?plLine?.netMassKg:line.netMassKg;
     const workingGross=selectedWeightSource==="packing_list"?plLine?.grossMassKg:line.grossMassKg;
     return {
       no:index+1,
       description:value(line.description)||"Unnamed goods line",
       hs:value(line.hsCode),
       origin:value(line.sourceCountryCode),
       quantity:value(line.quantity),
       net:value(workingNet),
       gross:value(workingGross),
       itemValue:value(line.totalValue)
     };
   });

   const conflicts=reconciliationIssues;

   const checks=[
     {label:"Invoice number",status:hasValue(invoice.invoiceNumber)?"pass":"warning",detail:hasValue(invoice.invoiceNumber)?value(invoice.invoiceNumber):"Not extracted"},
     {label:"Exporter",status:hasValue(invoice.exporter)?"pass":"warning",detail:hasValue(invoice.exporter)?value(invoice.exporter):"Not extracted"},
     {label:"Consignee",status:hasValue(invoice.consignee)?"pass":"warning",detail:hasValue(invoice.consignee)?value(invoice.consignee):"Not extracted"},
     {label:"HS codes",status:lines.every(l=>hasValue(l.hsCode))?"pass":"warning",detail:lines.every(l=>hasValue(l.hsCode))?"All goods lines have HS codes.":"One or more goods lines are missing an HS code."},
     {label:"Country of origin",status:lines.every(l=>hasValue(l.sourceCountryCode))?"pass":"warning",detail:lines.every(l=>hasValue(l.sourceCountryCode))?"All goods lines have an origin code.":"One or more goods lines are missing an origin code."},
     {label:"Weight comparison",status:weightsNeedDecision?"warning":"pass",detail:weightsNeedDecision?(selectedWeightSource?"Packing List weights are available; Commercial Invoice weights are missing or differ. "+(selectedWeightSource==="packing_list"?"Packing List":"Commercial Invoice")+" selected as the working source.":"Packing List weights are available; Commercial Invoice weights are missing or differ. Select a source for working customs weights."):"No line-level weight source issue detected."}
   ];

   const exportCountry=value(invoice.countryOfExport).trim().toUpperCase();
   const exporterCountryIso=value(invoice.exporterCountryIso).trim().toUpperCase();
   const exporterAddress=value(invoice.exporterAddress);
   const isGBExporter=exportCountry==="GB"||exporterCountryIso==="GB"||/(?:^|[\\n, ])(?:GB|UK|UNITED KINGDOM)(?:$|[\\n, ])/i.test(exporterAddress);
   const agentIssues=[];
   if(isGBExporter&&!hasValue(invoice.exporterEoriNo)){
     agentIssues.push({
       title:"GB exporter EORI missing",
       detail:"The exporter appears to be in Great Britain, but no EORI number was extracted. Check the commercial invoice for the EORI number. If it is present, tell me where it appears or re-process the document.",
       sourceDocumentId:invoiceDoc?.id||null,
       sourcePage:sourceFor(invoiceDoc)
     });
   }
   if(!hasValue(invoice.exporterAddressLine1)||!hasValue(invoice.exporterPostcode)||!hasValue(invoice.exporterCity)||!hasValue(invoice.exporterCountryIso)){
     agentIssues.push({
       title:"Exporter address incomplete",
       detail:"One or more structured exporter address fields are missing. Check the commercial invoice and correct the missing address component before posting to LCA.",
       sourceDocumentId:invoiceDoc?.id||null,
       sourcePage:sourceFor(invoiceDoc)
     });
   }
   if(weightsNeedDecision&&!pack.extractedData?.weightSourceDecision){
     agentIssues.push({
       title:"Weight source needs a decision",
       detail:ambiguousWeightIssues.length?"Some invoice lines could not be matched uniquely to Packing List lines. Review the source documents before choosing working customs weights.":packingListHasWeights&&!invoiceHasWeights?"Packing List weights are available for matching goods lines, but the Commercial Invoice contains no line-level weights. Choose the source for working customs weights, or email the customer for confirmation.":"The Commercial Invoice and Packing List have missing or different weights on matching goods lines. Choose the source for working customs weights, or email the customer for confirmation.",
       sourceDocumentId:packingDoc?.id||null,
       sourcePage:sourceFor(packingDoc)
     });
   }

   return [
     {type:"agent",text:"I've combined the document pack into one customs-entry summary. The table shows the working customs weights only; the selected source is recorded separately so the declaration is not carrying duplicate PKL/CIV weight columns.",persist:false},
     ...(agentIssues.length?[{
       type:"agentIssues",
       issues:agentIssues,
       persist:false
     }]:[]),
     {
       type:"customsEntrySummary",
       summary:{
         invoice:value(invoice.invoiceNumber),exporter:value(invoice.exporter),consignee:value(invoice.consignee),
         currency:value(invoice.currency),invoiceValue:value(invoice.totalInvoiceValue),exportCountry:value(invoice.countryOfExport),exporterAddress:value(invoice.exporterAddress),exporterAddressLine1:value(invoice.exporterAddressLine1),exporterPostcode:value(invoice.exporterPostcode),exporterCity:value(invoice.exporterCity),exporterCountryIso:value(invoice.exporterCountryIso),exporterEoriNo:value(invoice.exporterEoriNo),consigneeAddress:value(invoice.consigneeAddress),consigneeAddressLine1:value(invoice.consigneeAddressLine1),consigneePostcode:value(invoice.consigneePostcode),consigneeCity:value(invoice.consigneeCity),consigneeCountryIso:value(invoice.consigneeCountryIso),
         destination:value(invoice.sourceCountryOfDestination),packages:value(invoice.totalPackages),
         gross:value(selectedWeightSource==="packing_list"?(packingDoc?.extraction?.totalGrossWeight??sumWeight(customsLines,"gross")):invoice.totalGrossWeight),
         net:value(selectedWeightSource==="packing_list"?(packingDoc?.extraction?.totalNetWeight??sumWeight(customsLines,"net")):invoice.totalNetWeight),
         deliveryTerm:value(invoice.deliveryTerm),lines:customsLines,
         sourceLabel:invoiceDoc?.filename||"Commercial Invoice",sourceDocumentId:invoiceDoc?.id||null,sourcePage:sourceFor(invoiceDoc),weightSourceDecision:pack.extractedData?.weightSourceDecision?.source||null,
         weightSourceNote:ambiguousWeightIssues.length?ambiguousWeightIssues.length+" line(s) could not be matched uniquely. No Packing List weights have been applied to those lines.":selectedWeightSource==="invoice"&&packingListHasWeights&&!invoiceHasWeights?"The Commercial Invoice contains no line-level weights, so it cannot provide working net or gross values. Packing List weights remain available.":null
       },
       persist:false
     },
     {type:"validationSummary",checks:Array.isArray(pack.validationChecks)&&pack.validationChecks.length?pack.validationChecks:(Array.isArray(pack.extractedData?.validationChecks)&&pack.extractedData.validationChecks.length?pack.extractedData.validationChecks:checks),persist:false},
     ...(weightsNeedDecision&&!pack.extractedData?.weightSourceDecision?[{
       type:"weightDecision",
       text:ambiguousWeightIssues.length?"Some invoice lines could not be matched uniquely to Packing List lines. No ambiguous Packing List values will be applied. Review the linked sources, then choose which source to use for working customs weights.":packingListHasWeights&&!invoiceHasWeights?"Packing List weights are available for matching goods lines, but the Commercial Invoice contains no weights. The invoice remains the primary commercial document; choose which source to use for working customs weights. No extraction values have been copied.":"The Commercial Invoice and Packing List have missing or different line-level weights. Choose which source to use for working customs weights. No extraction values have been copied.",
       invoiceDocumentId:invoiceDoc?.id||null,
       invoicePage:sourceFor(invoiceDoc),
       packingDocumentId:packingDoc?.id||null,
       packingPage:sourceFor(packingDoc),
       conflicts,
       persist:false
     }]:[{type:"agent",text:weightsNeedDecision?"Weight source selected: "+(selectedWeightSource==="packing_list"?"Packing List":"Commercial Invoice")+". The selected source supplies working customs weights where lines were matched; source extractions remain unchanged."+(ambiguousWeightIssues.length?" "+ambiguousWeightIssues.length+" line(s) remain unresolved because their Packing List match is ambiguous.":""):"Cross-document validation: no line-level weight source issues require a decision.",persist:false}])
   ];
 };

 function sumWeight(customsLines,key){
   const values=customsLines.map(line=>line[key]).filter(value=>value!==undefined&&value!==null&&value!=="").map(Number).filter(Number.isFinite);
   return values.length?values.reduce((total,value)=>total+value,0):undefined;
 }
 useEffect(()=>{
   const saved=Array.isArray(pack.extractedData?.agentMessages)?pack.extractedData.agentMessages:[];
   setMessages([...buildSummary(),...saved]);
 },[pack.id,pack.extractedData?.extractionRunId,pack.extractedData?.weightSourceDecision?.selectedAt,pack.validationStatus,pack.validationChecks,pack.extractedData?.validationStatus,pack.extractedData?.validationChecks,extractedDocuments]);
 useEffect(()=>{if(!documentRows.length){setSelectedDocumentId(null);return;}setSelectedDocumentId(current=>documentRows.some(d=>(d.id||d.name)===current)?current:(documentRows[0].id||documentRows[0].name));},[pack.id,pack.uploadedFiles?.length]);

 const selectedDocument=documentRows.find(d=>(d.id||d.name)===selectedDocumentId)||documentRows[0];
 const selectedDocumentUrl=selectedDocument?docUrls[selectedDocument.id]:null;
 const selectedDocumentIsPdf=/\.pdf$/i.test(selectedDocument?.name||"");
 const selectedDocumentIsImage=/^image\//i.test(selectedDocument?.type||"")||/\.(png|jpe?g|webp|gif)$/i.test(selectedDocument?.name||"");
 const selectedDocumentFrameUrl=selectedDocumentUrl&&selectedDocumentIsPdf?selectedDocumentUrl+"#page="+previewPage+"&view=FitH&zoom=page-width":selectedDocumentUrl;

 const applyAgentAction=action=>{
   if(!action||action.kind!=="update_field")return null;
   const target=action.target||{}, data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   if(target.scope==="line"&&Number.isInteger(target.lineIndex)&&data.lines?.[target.lineIndex]){
     const line=data.lines[target.lineIndex];
     const oldValue=line[target.field];
     line[target.field]=target.value;
     data.reviewOverrides=[...(data.reviewOverrides||[]),{scope:"line",lineIndex:target.lineIndex,field:target.field,oldValue,newValue:target.value,sourceDocumentId:target.sourceDocumentId||null,sourcePage:target.sourcePage||null,createdAt:new Date().toISOString()}];
   }else if(target.scope==="primary"&&target.field){
     const oldValue=data[target.field];
     data[target.field]=target.value;
     data.reviewOverrides=[...(data.reviewOverrides||[]),{scope:"primary",field:target.field,oldValue,newValue:target.value,sourceDocumentId:target.sourceDocumentId||null,sourcePage:target.sourcePage||null,createdAt:new Date().toISOString()}];
   }else return null;
   updatePack?.({...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined});
   return "I saved that correction to the pack and cleared the previous validation result. The affected data needs to be validated again.";
 };
 const serialiseMessage=m=>({type:m.type||"agent",text:m.text||"",sourceDocumentId:m.sourceDocumentId||null,sourcePage:Number.isInteger(m.sourcePage)?m.sourcePage:null,sourceLabel:m.sourceLabel||null});
 const persistConversation=async conversation=>{
   const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   data.agentMessages=conversation.filter(m=>m.persist!==false).map(serialiseMessage);
   const nextPack={...pack,extractedData:data};
   const saved=await persistPack?.(nextPack);
   if(!saved) notify?.("Chat history could not be saved to the database");
   return saved;
 };
 const sendChat=async()=>{
   const q=chat.trim();if(!q||isSending)return;
   const userMessage={type:"user",text:q,persist:true};
   const thinking={type:"agent",text:"I'm checking the uploaded documents and their source evidence...",persist:false};
   const conversationBefore=[...messages,userMessage];
   setIsSending(true);setMessages([...conversationBefore,thinking]);setChat("");
   try{
     const response=await fetch("/api/agent",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:q,pack:{...pack,extractedData:{...(pack.extractedData||{}),agentMessages:undefined}}})});
     const result=await response.json();
     if(!response.ok)throw new Error(result.error||"Agent request failed");
     let reply=result.reply||"I couldn't produce an answer from the supplied pack.";
     let savedPack=pack;
     if(result.action==="update_field"&&result.target){
       const target=result.target;
       const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
       if(target.scope==="line"&&Number.isInteger(target.lineIndex)&&data.lines?.[target.lineIndex]) data.lines[target.lineIndex][target.field]=target.value;
       else if(target.scope==="primary"&&target.field) data[target.field]=target.value;
       else throw new Error("The agent returned an invalid correction target.");
       data.reviewOverrides=[...(data.reviewOverrides||[]),{scope:target.scope,field:target.field,lineIndex:target.lineIndex??null,oldValue:target.scope==="line"?pack.extractedData?.lines?.[target.lineIndex]?.[target.field]:pack.extractedData?.[target.field],newValue:target.value,sourceDocumentId:target.sourceDocumentId||null,sourcePage:target.sourcePage||null,createdAt:new Date().toISOString()}];
       savedPack={...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
       reply+=" I saved that correction to the pack and cleared the previous validation result. The affected data needs to be validated again.";
     }
     const agentMessage={type:"agent",text:reply,sourceDocumentId:result.target?.sourceDocumentId||null,sourcePage:result.target?.sourcePage||null,persist:true};
     const completed=[...conversationBefore,agentMessage];
     setMessages(completed);
     const data=JSON.parse(JSON.stringify(savedPack.extractedData||{}));
     data.agentMessages=completed.filter(m=>m.persist!==false).map(serialiseMessage);
     const finalPack={...savedPack,extractedData:data};
     updatePack?.(finalPack);
   }catch(error){
     const failed={type:"agent",text:"I couldn't reach the review agent. "+error.message,persist:true};
     const completed=[...conversationBefore,failed];
     setMessages(completed);
     const data=JSON.parse(JSON.stringify(pack.extractedData||{}));data.agentMessages=completed.filter(m=>m.persist!==false).map(serialiseMessage);
     const finalPack={...pack,extractedData:data};
     updatePack?.(finalPack);
   }finally{setIsSending(false);}
 };
 const decideWeights=(source,conflicts)=>{
   const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   const sourceLabel=source==="packing_list"?"Packing List":"Commercial Invoice";
   const matchedLines=Array.isArray(conflicts)?conflicts.filter(conflict=>!conflict.ambiguous).length:0;
   data.weightSourceDecision={source,sourceLabel,selectedAt:new Date().toISOString(),matchedLines};
   data.weightSelectionStatus="resolved";
   const next={...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
   updatePack?.(next);
   notify?.(sourceLabel+" selected as the working weight source for "+matchedLines+" matching line"+(matchedLines===1?"":"s"));
 };
 const emailWeightIssue=conflicts=>{
   const displayValue=v=>v===undefined||v===null||v===""?"—":String(v);
   const subject="Customs IDP - weight confirmation required";
   const body="Hello,\\n\\nThe Commercial Invoice and Packing List do not provide the same weight information. Please confirm which weights should be used for the customs declaration.\\n\\n"+conflicts.map(c=>"- "+(c.invoice.description||"Goods line")+": Commercial Invoice net "+displayValue(c.invoice.netMassKg)+" kg / gross "+displayValue(c.invoice.grossMassKg)+" kg; Packing List net "+displayValue(c.line?.netMassKg)+" kg / gross "+displayValue(c.line?.grossMassKg)+" kg"+(c.ambiguous?" (Packing List line match is ambiguous)":"")+".").join("\\n")+"\\n\\nRegards\\nCustoms IDP";
   setEmailDraft({to:"",subject,body});
 };
 const renderMessage=(m,i)=>{
   const source=m.sourceDocumentId&&m.sourcePage?sourceButton(m.sourceLabel||("Source — page "+m.sourcePage),m.sourceDocumentId,m.sourcePage):null;
   if(m.type==="weightDecision"){
     return <div className="chat-message-row agent" key={i}><div className="chat-message-avatar"><Sparkles size={15}/></div><div className="chat-message-content"><div className="chat-message-text">{m.text.split("\n").map((x,j)=><React.Fragment key={j}>{x}{j<m.text.split("\n").length-1&&<br/>}</React.Fragment>)}</div><div className="chat-source">{m.invoiceDocumentId&&sourceButton("Open Commercial Invoice",m.invoiceDocumentId,m.invoicePage||1)}{m.packingDocumentId&&sourceButton("Open Packing List",m.packingDocumentId,m.packingPage||1)}</div><div className="weight-decision-actions"><button className="secondary" onClick={()=>decideWeights("invoice",m.conflicts)}>Use Commercial Invoice weights</button><button className="secondary" onClick={()=>decideWeights("packing_list",m.conflicts)}>Use Packing List weights</button><button className="secondary" onClick={()=>emailWeightIssue(m.conflicts)}><Mail size={15}/> Email customer</button></div></div></div>;
   }
   if(m.type==="customsEntrySummary"&&m.summary){
     const s=m.summary;
     const addressLines=(structured,fullAddress,fallback)=>{
       const raw=structured||fullAddress||"";
       const lines=String(raw).split(/,|\\n/).map(x=>x.trim()).filter(Boolean);
       return lines.length?lines:[fallback];
     };
     const renderAddress=(structured,fullAddress,fallback)=>{
       const hasStructured=Boolean(String(structured||"").trim());
       const lines=addressLines(structured,fullAddress,fallback);
       return <>{lines.map((line,idx)=><span key={idx}>{line}</span>)}</>;
     };
     return <div className="chat-message-row agent" key={i}>
       <div className="chat-message-avatar"><Sparkles size={15}/></div>
       <div className="chat-message-content">
         <div className="customs-entry-summary-card">
           <div className="customs-summary-title">
             <div><span className="summary-kicker">CUSTOMS ENTRY SUMMARY</span><h3>{s.invoice||"Customs entry"}</h3></div>
             <span className="summary-status">Source: {s.sourceLabel}</span>
           </div>
           {s.weightSourceDecision&&<div className="weight-source-selected"><CheckCircle2 size={15}/><span><b>Working weights:</b> {s.weightSourceDecision==="packing_list"?"Packing List":"Commercial Invoice"} selected. {s.weightSourceNote||"The customs summary shows values from the selected source; source extraction remains unchanged."}</span></div>}
           <div className="customs-party-grid">
             <div className="customs-party-card">
               <span className="customs-party-label">Exporter</span>
               <b>{s.exporter||"—"}</b>
               <div className="customs-address-block">
                 {s.exporterAddressLine1
                   ? <>{renderAddress(s.exporterAddressLine1,"","")}<span>{s.exporterPostcode||""}</span><span>{s.exporterCity||""}</span><span>{s.exporterCountryIso||""}</span></>
                   : renderAddress("",s.exporterAddress,"")}
                 {s.exporterEoriNo&&<span><strong>EORI:</strong> {s.exporterEoriNo}</span>}
               </div>
             </div>
             <div className="customs-party-card">
               <span className="customs-party-label">Consignee</span>
               <b>{s.consignee||"—"}</b>
               <div className="customs-address-block">
                 {s.consigneeAddressLine1
                   ? <>{renderAddress(s.consigneeAddressLine1,"","")}<span>{s.consigneePostcode||""}</span><span>{s.consigneeCity||""}</span><span>{s.consigneeCountryIso||""}</span></>
                   : renderAddress("",s.consigneeAddress,"")}
               </div>
             </div>
           </div>
           <div className="customs-header-table">
             <div><span>Currency</span><b>{s.currency||"—"}</b></div>
             <div><span>Invoice Value</span><b>{s.invoiceValue?((s.currency||"")+" "+s.invoiceValue):"—"}</b></div>
             <div><span>Export</span><b>{s.exportCountry||"—"}</b></div>
             <div><span>Destination</span><b>{s.destination||"—"}</b></div>
             <div><span>Packages</span><b>{s.packages||"—"}</b></div>
             <div><span>Gross Weight</span><b>{s.gross!==""&&s.gross!=null?s.gross+" kg":"—"}</b></div>
             <div><span>Net Weight</span><b>{s.net!==""&&s.net!=null?s.net+" kg":"—"}</b></div>
             <div><span>Delivery Term</span><b>{s.deliveryTerm||"—"}</b></div>
           </div>
           <div className="customs-summary-section">
             <div className="summary-section-title">Goods lines <span>{s.lines.length}</span></div>
             <div className="customs-line-table-wrap">
               <table className="customs-line-table">
                 <thead><tr><th>Line</th><th>Goods Description</th><th>HS Code</th><th>Origin</th><th>Qty</th><th>Net Weight (kg)</th><th>Gross Weight (kg)</th><th>Value</th></tr></thead>
                 <tbody>{s.lines.map(line=><tr key={line.no}><td>{line.no}</td><td>{line.description}</td><td>{line.hs||"—"}</td><td>{line.origin||"—"}</td><td>{line.quantity||"—"}</td><td>{line.net!==""&&line.net!=null?line.net:"—"}</td><td>{line.gross!==""&&line.gross!=null?line.gross:"—"}</td><td>{line.itemValue?(s.currency+" "+line.itemValue):"—"}</td></tr>)}</tbody>
               </table>
             </div>
           </div>
           {source&&<div className="summary-source">{source}</div>}
         </div>
       </div>
     </div>;
   }
   if(m.type==="agentIssues"&&Array.isArray(m.issues)){
     return <div className="chat-message-row agent" key={i}><div className="chat-message-avatar"><AlertCircle size={15}/></div><div className="chat-message-content"><div className="validation-summary-card agent-issues-card"><div className="customs-summary-title"><div><span className="summary-kicker">ATTENTION REQUIRED</span><h3>Issues found during document review</h3></div></div><div className="validation-check-list">{m.issues.map((issue,idx)=><div className="validation-check warning" key={idx}><span>!</span><div><b>{issue.title}</b><small>{issue.detail}</small>{issue.sourceDocumentId&&<div className="chat-source">{sourceButton("Open source document",issue.sourceDocumentId,issue.sourcePage||1)}</div>}</div></div>)}</div></div></div></div>;
   }
   if(m.type==="validationSummary"&&Array.isArray(m.checks)){
     return <div className="chat-message-row agent" key={i}><div className="chat-message-avatar"><ShieldCheck size={15}/></div><div className="chat-message-content"><div className="validation-summary-card"><div className="customs-summary-title"><div><span className="summary-kicker">VALIDATION RESULTS</span><h3>Document and customs checks</h3></div></div><div className="validation-check-list">{m.checks.map((check,idx)=><div className={"validation-check "+check.status} key={idx}><span>{check.status==="pass"?"✓":check.status==="not_applicable"?"—":"!"}</span><div><b>{check.label||check.check||"Validation check"}</b><small>{check.detail||check.message||""}</small></div></div>)}</div></div></div></div>;
   }
   return <div className={"chat-message-row "+(m.type||"agent")} key={i}><div className="chat-message-avatar">{m.type==="user"?"You":<Sparkles size={15}/>}</div><div className="chat-message-content"><div className="chat-message-text">{m.text}</div>{source&&<div className="chat-source">{source}</div>}</div></div>;
 };

 return <section className="review-chat-page">
   <button className="back" onClick={back}>← Back to inbox</button>
   <div className="review-head"><div><div className="eyebrow">{pack.id} · {pack.ticket}</div><h1>{pack.customer}</h1><p>{pack.docs} documents · received {pack.received}</p></div><div className="review-actions"><select className="owner-select review-owner" value={pack.assignedTo||"Unassigned"} onChange={e=>onAssign?.(pack.id,e.target.value)}><option>Unassigned</option><option>Liam Wingrove</option><option>Data Processor 1</option><option>Data Processor 2</option><option>Muhammad Amer</option></select><Status status={pack.status}/><button className="secondary" onClick={()=>reprocessPack?.(pack)}>Re-process</button><button className="secondary" onClick={validatePack}>Validate data</button><button className={pack.status==="Ready"?"primary":"secondary"} onClick={postToLCA}>Post to LCA</button></div></div>
   <div className="chat-review-panel chat-review-full">
     <div className="chat-review-head"><div className="agent-title"><div className="agent-orb"><Sparkles size={18}/></div><div><b>Extraction Agent</b><span>Source-grounded document review</span></div></div><div className="chat-review-head-actions"><button type="button" className="secondary review-show-document-btn" onClick={()=>{setSelectedDocumentId(selectedDocumentId||(documentRows[0]?.id||documentRows[0]?.name));setPreviewPage(1);setShowPreview(true);}}><FileText size={14}/> Show document</button><span className="online-pill"><span></span> Ready</span></div></div>
     <div className="chat-review-intro">I read the complete document pack first. The conversation below is the review record: extracted values stay connected to their source, and discrepancies are surfaced rather than silently resolved.</div>
     <div className="chat-history chat-review-history">{messages.map(renderMessage)}</div>
     <div className="chat-input chat-review-input"><input value={chat} onChange={e=>setChat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Ask where a value came from, why it was used, or tell the agent what to change..."/><button onClick={sendChat}><ArrowRight size={16}/></button></div>
   </div>
   {showPreview&&selectedDocumentUrl&&<div className="review-source-modal-overlay" onClick={()=>setShowPreview(false)}>
     <div className="review-source-modal" onClick={e=>e.stopPropagation()}>
       <div className="review-source-modal-head">
         <div><span>DOCUMENT SOURCE · PAGE {previewPage}</span><b>{selectedDocument?.name||"Source document"}</b></div>
         <button type="button" className="row-btn" onClick={()=>setShowPreview(false)}><X size={18}/></button>
       </div>
       <div className="review-source-modal-toolbar"><div><FileText size={14}/><span>{selectedDocument?.name||"Source document"}</span></div><div className="review-viewer-controls"><span>Page {previewPage}</span><button type="button" onClick={()=>setPreviewPage(p=>Math.max(1,p-1))}>−</button><button type="button" onClick={()=>setPreviewPage(p=>p+1)}>+</button></div></div>
       <div className={"review-source-modal-body "+(selectedDocumentIsImage?"image-document":"pdf-document")}>{selectedDocumentUrl?(selectedDocumentIsImage?<img src={selectedDocumentUrl} alt={selectedDocument?.name||"Document preview"}/>:<iframe src={selectedDocumentFrameUrl} title={selectedDocument?.name||"Document preview"}/>):<div className="review-document-empty"><FileText size={28}/><b>{selectedDocument?.name||"No document available"}</b><span>The document is not available for preview yet.</span></div>}</div>
     </div>
   </div>}
   {emailDraft&&<div className="email-draft-overlay" onClick={()=>setEmailDraft(null)}><div className="email-draft-modal" onClick={e=>e.stopPropagation()}><div className="email-draft-head"><div><span className="summary-kicker">EMAIL CUSTOMER</span><h3>Weight confirmation request</h3></div><button type="button" className="row-btn" onClick={()=>setEmailDraft(null)}><X size={17}/></button></div><label>To<input value={emailDraft.to} onChange={e=>setEmailDraft({...emailDraft,to:e.target.value})} placeholder="customer@email.com" autoFocus/></label><label>Subject<input value={emailDraft.subject} onChange={e=>setEmailDraft({...emailDraft,subject:e.target.value})}/></label><label>Message<textarea rows="10" value={emailDraft.body} onChange={e=>setEmailDraft({...emailDraft,body:e.target.value})}/></label><div className="email-draft-actions"><button type="button" className="secondary" onClick={()=>{navigator.clipboard?.writeText(emailDraft.body);notify?.("Email message copied to clipboard");}}>Copy message</button><button type="button" className="primary" disabled={!emailDraft.to.trim()} onClick={()=>{window.location.href="mailto:"+encodeURIComponent(emailDraft.to.trim())+"?subject="+encodeURIComponent(emailDraft.subject)+"&body="+encodeURIComponent(emailDraft.body);setEmailDraft(null);}}>Open email</button></div></div></div>}
 </section>
}
function Customers({notify}){return <section><div className="page-head"><div><div className="eyebrow">Configuration</div><h1>Customers</h1><p>Customer-specific extraction strategies, mailboxes and validation rules.</p></div><button className="primary" onClick={()=>notify("Customer creation flow opened")}><Plus size={17}/> Add customer</button></div><div className="customer-grid">{customers.map(c=><div className="customer-card" key={c.code}><div className="customer-top"><div className="customer-logo">{c.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div><button className="row-btn"><MoreHorizontal size={17}/></button></div><h3>{c.name}</h3><span className="code">{c.code}</span><div className="customer-info"><div><Mail size={15}/><span>{c.mailbox}</span></div><div><Settings size={15}/><span>{c.rules} extraction rules</span></div><div><Activity size={15}/><span>{c.processed} documents processed</span></div></div><button className="full-btn">Open strategy <ArrowRight size={15}/></button></div>)}</div></section>}

function AgentPage(){
 const [messages,setMessages]=useState([{role:"agent",text:"Hi. I can inspect extracted customs data, explain decisions, validate fields, and prepare corrections. Try asking about HU, gross weight, HS codes or customer rules."}]);
 const [input,setInput]=useState("");
 const send=(textValue=input)=>{
   const q=textValue.trim(); if(!q) return;
   setMessages(m=>[...m,{role:"user",text:q}]); setInput("");
   const l=q.toLowerCase(); let reply;
   if(l.includes("gross")||l.includes("weight")) reply="The current pack uses the configured gross-weight apportionment logic: gross weight is distributed across eligible lines using each line's net-weight ratio. Bancale Legno is excluded from the net-weight calculation. In production, I will calculate this from the uploaded documents and show the source values before applying the rule.";
   else if(l.includes("hu")||l.includes("origin")) reply="HU is the ISO country code for Hungary. I would trace the value back to the source document, show the extracted text and confidence, then apply the customer's country-of-origin rule if one exists.";
   else if(l.includes("validate")) reply="I can validate required middleware fields, ISO country codes, procedure-code length and numeric fields. Any failure will be shown with the affected field and source document.";
   else if(l.includes("rule")) reply="I can inspect the customer's active rules and, after you confirm a correction, turn a repeated correction into a customer-specific rule. Rule changes should be recorded in the audit trail.";
   else if(l.includes("change")||l.includes("correct")||l.includes("wrong")) reply="I can make that correction once the pack is loaded. I will show the proposed old value → new value, explain the reason, recalculate dependent fields, and re-run validation before approval.";
   else reply="I understand. In the live version I will use the uploaded pack, extracted fields, source documents and customer strategy as context rather than answering from a generic knowledge base.";
   setTimeout(()=>setMessages(m=>[...m,{role:"agent",text:reply}]),250);
 };
 return <section><div className="page-head"><div><div className="eyebrow">Automation & intelligence</div><h1>AI Agent</h1><p>Explain extraction decisions, validate customs data and maintain customer-specific rules.</p></div><span className="online-pill"><span></span> Online</span></div><div className="agent-page-grid"><div className="panel"><div className="panel-head"><div><h2>Agent capabilities</h2><p>Actions the production agent will perform against a pack</p></div></div>{["Explain why a field was extracted","Correct an extracted value","Create or update a customer rule","Validate middleware fields and ISO codes","Apply weight apportionment rules","Flag low-confidence customs data"].map(x=><div className="capability" key={x}><div className="cap-icon"><Sparkles size={15}/></div><span>{x}</span><CheckCircle2 size={16}/></div>)}</div><div className="panel chat-large"><div className="agent-title"><div className="agent-orb"><Sparkles size={18}/></div><div><b>Customs IDP Agent</b><span>Pack-aware workflow assistant</span></div></div><div className="chat-history">{messages.map((m,i)=><div className={"message "+m.role} key={i}>{m.text}</div>)}<div className="suggestions"><button onClick={()=>send("Why was the gross weight apportioned?")}>Why was the gross weight apportioned?</button><button onClick={()=>send("Show Acme's active rules")}>Show Acme's active rules</button><button onClick={()=>send("Validate this pack for middleware")}>Validate this pack for middleware</button></div></div><div className="chat-input"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask the agent anything about this operation..."/><button onClick={()=>send()}><ArrowRight size={16}/></button></div></div></div></section>}

function SettingsPage(){return <section><div className="page-head"><div><div className="eyebrow">Platform</div><h1>Settings</h1><p>Core processing, middleware and integration configuration.</p></div></div><div className="settings-grid"><div className="panel settings-card"><h2>Middleware</h2><p>Configure the output contract used by the downstream customs system.</p><label>Endpoint</label><input value="https://middleware.internal/customs/orders" readOnly/><label>Format</label><select><option>JSON</option></select><label>Destination</label><input value="ASM UK" readOnly/></div><div className="panel settings-card"><h2>Processing defaults</h2><p>Global fallbacks used when a customer has no overriding rule.</p><Toggle label="Automatic validation" on/><Toggle label="Low-confidence review queue" on/><Toggle label="Auto-send validated packs" on/></div></div></section>}

function Toggle({label,on}){return <div className="toggle-row"><span>{label}</span><div className={"toggle "+(on?"on":"")}><i></i></div></div>}

createRoot(document.getElementById("root")).render(<App/>);
// Vercel redeploy trigger after connection reset 2026-09-18T20:26:46.067Z
