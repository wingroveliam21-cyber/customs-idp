import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INBOX_COLUMN_KEYS, normaliseDatabasePack, normaliseInboxColumnSelection } from "../src/domain/packData.js";
import { canOpenPack, formatReceivedDateTime, getPackColumnValue, getPackCustomerLabel, getPackDisplayName, reconcilePackDocuments } from "../src/domain/packView.js";

test("allows errored processing packs to open for recovery",()=>{
  assert.equal(canOpenPack({status:"Processing"}),false);
  assert.equal(canOpenPack({status:"Processing",processingError:"Extraction failed"}),true);
  assert.equal(canOpenPack({status:"Needs review"}),true);
});

test("formats ISO received dates and preserves invalid values",()=>{
  const value="2026-09-19T18:49:25.577Z";
  const date=new Date(value);
  const pad=n=>String(n).padStart(2,"0");
  assert.equal(formatReceivedDateTime(value),`${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`);
  assert.equal(formatReceivedDateTime("not-a-date"),"not-a-date");
});

test("uses singular document wording for one document",()=>{
  assert.equal(getPackColumnValue({id:"PK-1",docs:1},"documents"),"1 document");
  assert.equal(getPackColumnValue({id:"PK-2",docs:2},"documents"),"2 documents");
});

test("uses the retained source document name as the pack display name",()=>{
  const pack={id:"PK-1",extractedData:{documents:[{filename:"commercial-invoice-10482.pdf"}]}};
  assert.equal(getPackDisplayName(pack),"commercial-invoice-10482.pdf");
  assert.equal(getPackColumnValue(pack,"pack"),"commercial-invoice-10482.pdf");
  assert.equal(getPackDisplayName({...pack,email:{subject:"Customs documents"}}),"commercial-invoice-10482.pdf");
  assert.equal(getPackDisplayName({id:"PK-1"}),"Document pack");
});

test("uses the requested inbox columns by default",()=>{
  assert.deepEqual(DEFAULT_INBOX_COLUMN_KEYS,["pack","customer","owner","documents","status","received"]);
  assert.deepEqual(normaliseInboxColumnSelection([]),DEFAULT_INBOX_COLUMN_KEYS);
  assert.deepEqual(normaliseInboxColumnSelection(["status","received","unknown","status"]),["status","received"]);
  assert.deepEqual(normaliseInboxColumnSelection(["pack","packId","customer"]),["pack","customer"]);
});

test("normalizes database pack metadata without changing extracted fields",()=>{
  const pack=normaliseDatabasePack({id:"PK-1",organisation_id:"org-1",assigned_to:"Liam",extracted_data:{_tenant:{organisationId:"org-1",organisationName:"Org"},_manager:{uploadedFiles:[{id:"file-1"}]},_validation:{validationStatus:"Validated"},invoiceNumber:"INV-1"}});
  assert.equal(pack.organisationId,"org-1");
  assert.equal(pack.organisationName,"Org");
  assert.equal(pack.assignedTo,"Liam");
  assert.equal(pack.validationStatus,"Validated");
  assert.equal(pack.extractedData.invoiceNumber,"INV-1");
  assert.deepEqual(pack.uploadedFiles,[{id:"file-1"}]);
});

test("derives customer label from extracted exporter when unassigned",()=>{
  assert.equal(getPackCustomerLabel({customer:"Unassigned customer",extractedData:{exporterName:"Example Exporter"}}),"Example Exporter");
});

test("reports cross-document reconciliation conflicts",()=>{
  const result=reconcilePackDocuments({extractedData:{documents:[
    {filename:"invoice.pdf",extraction:{invoiceNumber:"INV-1",lines:[{description:"A"}]}},
    {filename:"packing.pdf",extraction:{invoiceNumber:"INV-2",lines:[{description:"A"}]}}
  ]}});
  assert.equal(result.status,"conflict");
  assert.match(result.summary,/conflict/);
  assert.equal(result.conflicts[0].label,"Invoice number");
});
