import test from "node:test";
import assert from "node:assert/strict";
import { applyCustomerStrategyRules, summariseCustomerStrategyExecution } from "../src/domain/customerStrategyExecution.js";

test("applies configured field and copy-if-missing rules and audits source values",()=>{
  const result=applyCustomerStrategyRules({invoiceNumber:"INV-1",consignee:{country:"DE"},destination:null},{
    fieldRules:[
      {type:"set_field",field:"deliveryTerm",value:"DAP",reason:"Customer always uses DAP"},
      {type:"copy_if_missing",field:"sourceCountryOfDestination",sourceField:"consignee.country"},
      {type:"map_value",field:"deliveryTerm",mapping:{DAP:"DAP"}}
    ]
  });
  assert.equal(result.record.deliveryTerm,"DAP");
  assert.equal(result.record.sourceCountryOfDestination,"DE");
  assert.equal(result.changes.length,2);
  assert.equal(result.applications.length,3);
});

test("required fields are flagged without blocking the record",()=>{
  const result=applyCustomerStrategyRules({invoiceNumber:"INV-1"},{requiredFields:["invoiceNumber","exporterEoriNo"]});
  assert.equal(result.record.invoiceNumber,"INV-1");
  assert.equal(result.exceptions.length,1);
  assert.equal(result.exceptions[0].field,"exporterEoriNo");
  assert.equal(result.applications.find(x=>x.field==="exporterEoriNo").status,"exception");
});

test("unsupported or narrative rules are reported rather than claimed as applied",()=>{
  const result=applyCustomerStrategyRules({},{
    extractionRules:["Always use packing list weights"],
    fieldRules:[{type:"unknown_magic",field:"x"}],
    validationRules:[{type:"regex",field:"invoiceNumber",pattern:"^INV"}]
  });
  assert.equal(result.applications.filter(x=>x.status==="unsupported").length,3);
  assert.equal(result.changes.length,0);
});

test("validation exceptions and execution summary retain auditable counts",()=>{
  const execution=applyCustomerStrategyRules({status:"pending"},{customValidations:[{type:"equals",field:"status",expected:"released"}]});
  const summary=summariseCustomerStrategyExecution(execution);
  assert.equal(summary.evaluated,1);
  assert.equal(summary.exceptions.length,1);
  assert.equal(summary.exceptions[0].actual,"pending");
});

test("customer-specific approval requirements hold changes and report pending approval",()=>{
  const result=applyCustomerStrategyRules({deliveryTerm:"EXW"},{approvalRequirements:[{action:"set_field",field:"deliveryTerm",required:true}],fieldRules:[{type:"set_field",field:"deliveryTerm",value:"DAP"}]});
  assert.equal(result.record.deliveryTerm,"EXW");
  assert.equal(result.applications[0].status,"pending_approval");
  assert.equal(result.exceptions[0].status,"pending_approval");
});
