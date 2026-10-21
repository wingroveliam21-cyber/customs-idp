import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkingCustomsRecord } from "../src/domain/workingRecord.js";

const packWithWeights = () => ({
  customer: "Fenwick Laboratory Supplies Ltd",
  extractedData: {
    totalNetWeight: 70,
    totalGrossWeight: 74,
    lines: [
      { line: 1, description: "Glassware", netMassKg: 12.5, grossMassKg: 13.1, totalValue: 1269 },
      { line: 2, description: "Lab coats", netMassKg: 18, grossMassKg: 19.2, totalValue: 1580 },
      { line: 3, description: "Containers", netMassKg: 22.25, grossMassKg: 23.5, totalValue: 1925 },
      { line: 4, description: "Goggles", netMassKg: 16.75, grossMassKg: 17.8, totalValue: 2304 }
    ],
    documents: [{
      id: "packing-list",
      filename: "packing-list.xlsx",
      extraction: {
        documentType: "packing_list",
        totalNetWeight: 70,
        totalGrossWeight: 74,
        lines: [
          { line: 1, description: "Glassware", netMassKg: 12.5, grossMassKg: 13.1, totalValue: 1269 },
          { line: 2, description: "Lab coats", netMassKg: 18, grossMassKg: 19.2, totalValue: 1580 },
          { line: 3, description: "Containers", netMassKg: 22.25, grossMassKg: 23.5, totalValue: 1925 },
          { line: 4, description: "Goggles", netMassKg: 16.75, grossMassKg: 17.8, totalValue: 2304 }
        ]
      }
    }]
  }
});

test("customer strategy sums net and gross line weights and records source discrepancies", () => {
  const record = buildWorkingCustomsRecord(packWithWeights(), {
    weightAggregation: { net: "sum_lines", gross: "sum_lines", conflict: "review" }
  });
  assert.equal(Number(record.totalNetWeight), 69.5);
  assert.equal(Number(record.totalGrossWeight), 73.6);
  assert.equal(Number(record.sourceTotalNetWeight), 70);
  assert.equal(Number(record.sourceTotalGrossWeight), 74);
  assert.equal(record.customerStrategyApplications.filter(item => item.category === "weightAggregation").length, 2);
  assert.equal(record.customerStrategyApplications.filter(item => item.category === "weightAggregation" && item.status === "exception").length, 2);
  assert.equal(record.sourceDiscrepancies.filter(item => item.category === "weightAggregation").length, 2);
  assert.equal(record.customerStrategyChanges.filter(item => item.category === "weightAggregation").length, 2);
});

test("customer strategy can preserve document totals when line sums conflict", () => {
  const record = buildWorkingCustomsRecord(packWithWeights(), {
    weightAggregation: { net: "sum_lines", gross: "sum_lines", conflict: "source" }
  });
  assert.equal(Number(record.totalNetWeight), 70);
  assert.equal(Number(record.totalGrossWeight), 74);
  assert.equal(Number(record.sourceTotalNetWeight), 70);
  assert.equal(Number(record.sourceTotalGrossWeight), 74);
  assert.equal(record.customerStrategyApplications.filter(item => item.category === "weightAggregation" && item.status === "applied").length, 2);
});

test("weight aggregation remains disabled for customers without explicit configuration", () => {
  const record = buildWorkingCustomsRecord(packWithWeights(), {});
  assert.equal(Number(record.totalNetWeight), 70);
  assert.equal(Number(record.totalGrossWeight), 74);
  assert.equal(record.customerStrategyChanges.some(item => item.category === "weightAggregation"), false);
});
