import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkingCustomsRecord } from "./workingRecord.js";
import validateStandardCustomsRecord from "../validation/standardEngine.js";

test("SUM_LINE_AMOUNTS records source, working total, difference and audit change", () => {
  const pack = {
    customer: { name: "Fenwick Laboratory Supplies Ltd" },
    extractedData: {
      totalInvoicedAmount: 666,
      currency: "GBP",
      documents: [{
        filename: "invoice.pdf",
        extraction: {
          documentType: "commercial_invoice",
          lines: [
            { lineNo: 1, quantity: 9, totalValue: 1269, description: "Line 1" },
            { lineNo: 2, quantity: 10, totalValue: 1580, description: "Line 2" },
            { lineNo: 3, quantity: 11, totalValue: 1925, description: "Line 3" },
            { lineNo: 4, quantity: 12, totalValue: 2304, description: "Line 4" }
          ]
        }
      }]
    }
  };
  const strategy = {
    customerName: "Fenwick Laboratory Supplies Ltd",
    invoiceTotalRule: { id: "SUM_LINE_AMOUNTS", type: "SUM_LINE_AMOUNTS", enabled: true }
  };

  const record = buildWorkingCustomsRecord(pack, strategy);
  assert.equal(record.sourceInvoiceTotal, 666);
  assert.equal(record.totalInvoicedAmount, 7078);
  assert.equal(record.invoiceTotalRuleApplied.ruleId, "SUM_LINE_AMOUNTS");
  assert.equal(record.invoiceTotalRuleApplied.difference, 6412);
  assert.ok(record.customerStrategyApplications.some(x => x.category === "invoiceTotal" && x.status === "applied" && x.ruleId === "SUM_LINE_AMOUNTS"));
  assert.ok(record.customerStrategyChanges.some(x => x.category === "invoiceTotal" && x.before === 666 && x.after === 7078 && x.difference === 6412));
});

test("validation surfaces a review when a configured invoice-total override differs from source", () => {
  const result = validateStandardCustomsRecord({
    totalInvoicedAmount: 7078,
    totalInvoiceValue: 7078,
    currency: "GBP",
    invoiceTotalRuleApplied: {
      ruleId: "SUM_LINE_AMOUNTS",
      sourceInvoiceTotal: 666,
      workingInvoiceTotal: 7078,
      difference: 6412
    },
    documents: [],
    lines: []
  });
  assert.ok(result.checks.some(x => x.field === "invoiceTotalRuleApplied" && x.status === "review" && x.ruleId === "SUM_LINE_AMOUNTS"));
});
