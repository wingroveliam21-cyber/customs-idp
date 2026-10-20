import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkingCustomsRecord } from "../src/domain/workingRecord.js";

test("customer source priority overrides conflicting top-level fields and records provenance",()=>{
  const pack={customer:"Example",extractedData:{
    invoiceNumber:"INV-1",
    currency:"GBP",
    documents:[
      {id:"inv",filename:"invoice.pdf",extraction:{documentType:"commercial_invoice",currency:"GBP",deliveryTerm:"EXW",lines:[]}},
      {id:"pl",filename:"packing.pdf",extraction:{documentType:"packing_list",deliveryTerm:"DAP",lines:[]}}
    ]
  }};
  const record=buildWorkingCustomsRecord(pack,{sourcePriority:["packing_list","commercial_invoice"]});
  assert.equal(record.deliveryTerm,"DAP");
  assert.equal(record.customerStrategyApplications.find(x=>x.category==="sourcePriority").status,"applied");
  assert.equal(record.customerStrategyChanges.some(x=>x.field==="deliveryTerm"&&x.before==="EXW"&&x.after==="DAP"),true);
});

test("invoice-total strategy keeps source total and calculates working total",()=>{
  const pack={customer:"Example",extractedData:{
    totalInvoiceValue:666,
    lines:[{totalValue:4000},{totalValue:3078}],
    documents:[{id:"inv",filename:"invoice.pdf",extraction:{documentType:"commercial_invoice",totalInvoiceValue:666,lines:[{totalValue:4000},{totalValue:3078}]}}]
  }};
  const record=buildWorkingCustomsRecord(pack,{instructions:"For this customer, always use the sum of item-line amounts as the working invoice total for customs reconciliation."});
  assert.equal(record.totalInvoicedAmount,7078);
  assert.equal(record.sourceInvoiceTotal,666);
  assert.equal(record.invoiceTotalRuleApplied.lineCount,2);
});
