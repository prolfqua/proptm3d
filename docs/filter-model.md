# Filtering data model

The browser does not contain a database or execute SQL. Python prepares related Parquet tables; the browser loads them, joins selected metadata in memory, and performs set operations on site identities. Thinking of this as a small relational model is useful because it separates three questions: **what data exists**, **which sites are selected**, and **how a view draws those sites**. The [prepared-data contract](data.md) lists the physical files; this page describes the logical model and its TypeScript implementation.

## Entities and keys

```text
Protein (protein_Id)
  └── MeasuredSite (protein_Id, site)  ← complete selection universe U
        ├── SiteResult (protein_Id, site, contrast)  [0..many]
        ├── StructuralContext (protein_Id, site, model)  [0..many]
        ├── Measurement (protein_Id, site, sample)  [0..many]
        └── GseaMembership (result, contrast, source, sequence_set, window/rank)  [0..many]
              ├── GseaSequenceSet (result, contrast, source, sequence_set)
              └── GseaCurve (result, contrast, source, sequence_set)
```

| Logical relation | Key or scope | Role in filtering |
| --- | --- | --- |
| Measured site | `(protein_Id, site)` | Defines **U**, including sites with no statistical result, structural match, or sequence-set membership. The browser represents this pair as a delimiter-separated `siteIdentity` string; the string is an in-memory key, not a new prepared-data column. |
| Site result | `(protein_Id, site, contrast)` | Supplies site FDR, log2FC and estimate type. A single measured site can have results in several contrasts or none. |
| Structural context | Site plus model context | Supplies Exposure and Region classifications. Missing or mismatched context remains distinct from a classified Buried or Structured site. |
| GSEA result and sequence_set | One active result and contrast; `(source, sequence_set)` identifies a set within that payload | The result/contrast chooses the loaded payload. The source-qualified set key prevents equal display names from colliding. GSEA FDR determines which sets are eligible. |
| GSEA membership | Set plus site and ranked sequence window | Connects an eligible set to sites. Several windows or ranks can map to one site; set construction deduplicates by site identity. Leading-edge mode keeps only source-labelled leading-edge members. |
| Measurements, features, structures and curves | Sample, protein, model or set context | Supply detail and plots after selection; they do not redefine the selected site set. |

The browser's `AppData.sites` is the complete measured-site catalog. `AppData.siteIndex` is a result-bearing index joined with site and structural metadata; it is **not** the selection universe. A's selected contrast names restrict the upper contrast selector, but A's site output does not filter B memberships. That upper contrast is also B's GSEA contrast; changing it while B is active reloads B and can change site membership. B loads one compatible enrichment result and contrast at a time. The same upper contrast supplies C's Estimate membership when Estimate is enabled; changing it can therefore change C's effective sites even in a Stats browser. The upper sequence-set choice only inspects a running curve; an active B locks its GSEA method until turned Off.

## Query-like selection pipeline

```text
Prepared rows ──► set definitions + (site, set) pairs ──► A and B relation results
                    A: significant sites per contrast      │
                    B: members per eligible sequence_set   │
                                                            ▼
              Estimate / Exposure / Region pairs ──► C relation result
                                                            │
                                      C selection (Off / All / set / exact)
                                      + global filtering On / Off
                                                            ▼
                                       one deduplicated site-key set
                                                            │
                         protein tables · detail · abundance · logos · highlights
```

This is the equivalent of a few joins, projections and `DISTINCT` set operations, not a sequence of view-specific `WHERE` clauses. Each relation has definitions `(id, label, enabled)` and membership pairs `(site identity, set id)`. The evaluator deduplicates repeated pairs, derives whole-set members and their union, then groups only observed exact signatures:

```text
A_named[contrast] = DISTINCT site keys from SiteResult
                    WHERE result.contrast = contrast
                      AND result.fdr < site_fdr_cutoff
                      AND abs(result.effect) > log2fc_cutoff

B_context          = one result + one contrast allowed by A's selected names
B_eligible         = GseaSequenceSet for B_context
                    WHERE set.fdr < gsea_fdr_cutoff
B_named[set]       = DISTINCT site keys from that set's memberships
                    [restricted to leading-edge rows when enabled]

A_output           = resolve(A_named, A_selection)
B_output           = resolve(B_named, B_selection)
C_operands         = enabled A_output, enabled B_output,
                     enabled Estimate, Exposure and Region site sets
C_all              = UNION DISTINCT C_operands; if none enabled, U
C_exact[signature] = sites in exactly the marked enabled C operands
filtered_sites     = UNION DISTINCT enabled A_output and B_output when C is Off
                     (or U when both A and B are Off)
                   = resolve(C, C_selection) otherwise
effective_sites    = U when global filtering is Off; otherwise filtered_sites
```

`Off` disables only its branch. A/B Off contribute no operand; C Off leaves the selected A/B outputs effective but ignores C's Estimate, Exposure and Region operands. It is not an operand containing every site. The separate global filtering switch bypasses every branch and shows the complete measured-site catalog without clearing selections. The model still computes `filtered_sites` for the UpSet preview while global filtering is Off; only `effective_sites` feeds result views. `All` means the union of the named sets within that UpSet. A named selection means the whole named set, including shared sites. An exact intersection is a membership signature: a site must be in every marked set and absent from every other enabled set in that same UpSet. For example, selecting the A+B column in C requires both; leaving C at All includes sites satisfying A **or** B (or another enabled property operand). An enabled B with zero eligible sets resolves to an empty set, not to Off. Loading or failed GSEA data is a separate state, not a successful empty result.

The shared relation evaluator partitions only **observed** membership signatures. It does not enumerate the `2^n` possible signatures or use a 32-bit bit mask. A reads significant site-result rows. B receives the upper A-permitted contrast, then reads one compatible GSEA payload and filters set definitions by GSEA FDR before applying optional leading-edge membership. An A named set permits one upper contrast; an exact A intersection permits its marked contrasts; A Off/All permits every prepared contrast. The upper method chooser offers only results for the current contrast; while B is Off it supplies B's candidate payload, and an active B locks that method. This is a context dependency, not a site-level A∩B operation. C is a new relation whose A/B membership rows come from their separately resolved outputs; Estimate, Exposure and Region supply its other rows. Thus the plots do not return tables to be joined. Rows, searched names, dot-count choices, paging and the Selected/All plot toggle are display projections. They cannot change A/B/C membership or the complete eligible-set universe used to define an exact intersection. C's All view draws every observed exact signature, so its column counts partition the union and add up to the selected-site count.

## State, projections and ownership in code

| Code | Current responsibility |
| --- | --- |
| `web/src/types.ts`, `web/src/data.ts` | Prepared-row types, manifest, Parquet loading and browser-side metadata joins. |
| `web/src/membership.ts` | Generic normalized relation evaluator: set definitions, deduplicated site–set pairs, whole sets, union, observed exact signatures and selection resolution. No DOM or Plotly dependency. |
| `web/src/filtering.ts` | Domain-specific A/B/C relation inputs and the headless `FilterModel`: measured-site universe, shared selection/reclick rules, upstream resets, A-permitted upper contrast and effective site identities. |
| `web/src/gsea.ts`, `web/src/filter-status.ts` | Pure projections for the compatible GSEA result at the shared contrast, running-curve choices, and the compact filter summary. The UI controllers call these same functions. |
| `web/src/upset-model.ts` | Display-only row ordering, search, degree and Selected/All projections over relation results. |
| `web/src/upset.ts` | Plotly figure and interactive UpSet component; translates bar/column clicks into model selection commands. |
| `web/src/filter-panel.ts` | Controls, notices, paging and rendering. It receives the app-owned `FilterModel` instead of owning the data model. |
| `web/src/gsea-controller.ts` | Active result/contrast payload, GSEA FDR and leading-edge settings, plus running-curve inspection and GSEA presentation. Publishes raw payload and eligibility settings; `FilterModel` derives B, whose selection projects into the GSEA table and volcano highlights. |
| `web/src/app.ts` | Owns the `FilterModel`, display context and input settings; reads its effective `siteKeys` for workspaces. |

This is a real model/view boundary: A, B and C use the same `SetSelection` type and `FilterModel.select` transition, while the generic membership query runs in headless tests. The panel does not determine effective membership. The app and GSEA controller still own different **inputs** to the calculation: site thresholds and structural choices in the app, GSEA eligibility and result context in its controller. B selection determines which sequence-set rows appear in the GSEA table and which volcano points are highlighted. The upper sequence-set selector offers only B-eligible sets overlapping C's effective sites; choosing one changes curve focus, not filtering. Protein search likewise only navigates the result. The upper contrast is a shared context choice, not an independent site-level A∩B predicate: it limits B's payload, projects contrast-specific plot/detail values, and supplies C's enabled Estimate operand.

`web/tests/filter-dependencies.test.ts` exercises the production A → upper contrast → B result → C path without a DOM, Plotly, or network request. Its synthetic Stats and GSEA cases check the C union against exact-column totals, loading and leading-edge transitions, and the collapsed summary. Display rendering and click targets remain separate UI tests.

No prepared-data schema or user-visible selection semantics changed in this separation. A table library such as Arquero could later help with joins and aggregation if they become complex, but it would not replace the A/B/C state transitions or the exact-membership rules. Moving those rules behind a headless API makes such an experiment measurable without rewriting the views.
