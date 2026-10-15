import React from "react";
import { ChevronRight, FileText, MoreHorizontal, X } from "lucide-react";
import { DEFAULT_INBOX_COLUMNS, normaliseInboxColumnSelection } from "../domain/packData.js";
import { getPackColumnValue } from "../domain/packView.js";

function NavItem({icon:Icon,label,badge,active,onClick}){return <button className={"nav-item "+(active?"active":"")} aria-label={label} title={label} onClick={onClick}><Icon size={18}/><span>{label}</span>{badge&&<em>{badge}</em>}</button>}function Metric({label,value,delta,icon:Icon,warning}){return <div className="metric"><div className={"metric-icon "+(warning?"warning":"")}><Icon size={19}/></div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small className={delta.startsWith("-")?"positive":""}>{delta}</small></div></div>}
function Queue({label,value,pct,cls}){return <div className="queue"><div><span className={"queue-dot "+cls}></span><b>{label}</b><strong>{value}</strong></div><div className="progress"><i className={cls} style={{width:pct+"%"}}></i></div><small>{pct}%</small></div>}function PackTable({packs,onOpen,onAssign,onDelete,columns}){const visible=normaliseInboxColumnSelection(columns);return <div className="table-wrap"><table><thead><tr>{visible.map(k=><th key={k}>{DEFAULT_INBOX_COLUMNS.find(c=>c.key===k)?.label?.toUpperCase()||k.toUpperCase()}</th>)}<th></th></tr></thead><tbody>{packs.map(p=>{const processing=p.status==="Processing",blocked=processing&&!p.processingError;return <tr key={p.id} className={processing?"pack-processing-row":""} onClick={()=>{if(!blocked)onOpen(p)}}>{visible.map(k=><td key={k}>{k==="owner"?<select className="owner-select" value={p.assignedTo||"Unassigned"} onClick={e=>e.stopPropagation()} onChange={e=>onAssign?.(p.id,e.target.value)}><option>Unassigned</option><option>Liam Wingrove</option><option>Data Processor 1</option><option>Data Processor 2</option><option>Muhammad Amer</option></select>:k==="status"?<Status status={p.status}/>:k==="pack"?<><b>{getPackColumnValue(p,"pack")}</b>{processing&&<span className="pack-processing-note">{p.processingError?"Processing failed · open to retry":"Documents received · processing before review"}</span>}</>:getPackColumnValue(p,k)}</td>)}<td><button className="row-btn" disabled={blocked} onClick={e=>{e.stopPropagation();if(!blocked)onOpen(p)}}><MoreHorizontal size={17}/></button><button className="row-btn danger" disabled={blocked} onClick={e=>{e.stopPropagation();onDelete?.(p)}}><X size={17}/></button></td></tr>})}</tbody></table></div>}
function Status({status}){const c=status==="Ready"||status==="Validated"||status==="Posted to LCA"?"good":status==="Processing"?"processing":"review";return <span className={"status "+c}><span></span>{status}</span>}function SpreadsheetPreview({url}){
  const officeUrl="https://view.officeapps.live.com/op/view.aspx?src="+encodeURIComponent(url);
  return <div className="spreadsheet-preview-office">
    <iframe src={officeUrl} title="Excel document preview" />
  </div>;
}


export { NavItem, Metric, Queue, PackTable, Status, SpreadsheetPreview };
