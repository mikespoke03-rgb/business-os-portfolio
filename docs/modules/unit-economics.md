# Unit-economics models (channels)

**Goal.** Compare the unit margin of one product sold through different channels: domestic marketplace FBO, a foreign entity selling into the same marketplace, cross-border marketplace delivery, own web store (three CAC scenarios).

**Implementation.** `scripts/build_unit_economics_xlsx.py` builds `examples/unit_economics_example.xlsx` with openpyxl: a README sheet, an Inputs sheet with named yellow assumption cells, one sheet per channel with live Excel formulas, and a Compare sheet comparing the channels. Change an input and the workbook recalculates.

**Limits.** All numbers are illustrative; tax, VAT and customs treatment is deliberately simplified and must be verified with a professional. The real research models had the same structure but real inputs and are not included.
