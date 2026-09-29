# Explore prepared results

Opening a multi-method prepared root or bundle first shows an analysis overview with sample groups, preparation provenance, per-method coverage, and links to the DPA, DPU, and CF-DPU viewers. A single-method bundle opens its viewer directly.

## Shared controls

The controls above the workspaces select the FDR cutoff, minimum absolute log2 fold change, displayed contrast, estimate type, exposure class, predicted region, and protein search. After choosing an UpSet intersection, an UpSet selection toggle appears with these controls and reports its site and protein counts in every workspace. While the toggle is on, Displayed contrast offers only contrasts belonging to the exact intersection; a single-contrast intersection therefore selects and shows only that contrast. Turning the toggle off restores the complete contrast list without forgetting the chosen intersection. A result passes the statistical filters only when its FDR is strictly below the cutoff and its absolute effect is strictly above the cutoff.

Exposure and Region are independent structural annotations; they do not change whether a result is statistically significant. Both default to All. Selecting Exposed, Buried, IDR, or Structured excludes sites without matching AlphaFold structural context because those sites cannot satisfy the chosen category. The How to read this panel in the application explains the annotations and colors.

The protein tables, Protein detail, 3D markers, N-to-C markers, and Site abundance accept any FDR in `(0, 1]` and any absolute log2 fold-change cutoff of at least zero. The dense volcano and protein-versus-site plots retain a display cap: only sites with FDR below 0.25 and absolute log2 fold change above 1 can receive interactive red or blue overlays; the complete static black background remains visible.

GSEA preparations extend the same filter bar with an enrichment-result selector, GSEA FDR, sequence-set selector, **Leading edge only**, and an explicit **GSEA selection** toggle. Selecting a sequence set updates the GSEA Find view until the toggle is on. Once enabled, the selected full or leading-edge site set becomes one additional predicate shared by Find proteins, UpSet, the existing sequence logos, Protein detail, structure markers, and Site abundance. Changing the displayed contrast loads that contrast's selected enrichment result. Statistics-only preparations hide the GSEA controls and Find subtab.

## Find proteins

The Find proteins workspace has four views in a GSEA preparation and three in a statistics-only preparation:

- **All contrasts** summarizes measured, tested, significant, upregulated, and downregulated sites across the method's contrasts. A site-level UpSet plot groups each phosphosite by the exact set of contrasts in which it passes the active filters. Clicking an intersection bar or matrix dot restricts the protein table and its result counts to those sites, shows their compact residue labels, and reports how many proteins bear them. The selection also restricts Protein detail and Site abundance. Click the selected intersection again or turn off the global UpSet selection toggle to see all sites without forgetting the intersection; click a protein row to open its first matching site.
- **Single contrast** places the contrast-specific protein table beside a volcano and a total-protein-versus-original-site fold-change scatter. An active UpSet selection limits the interactive overlays to its sites: red and blue points pass in the displayed contrast, while amber points belong to the selected intersection but do not pass in this contrast. Hover a protein row to isolate that protein's selected points temporarily; leaving the row restores the complete selection overlay.
- **Single contrast sequlogos** shows the same UpSet-aware interactive overlays plus Up, Down, and Up-minus-Down amino-acid frequency logos calculated only from selected sites that pass in the displayed contrast. Plot points open the corresponding protein and site.
- **GSEA** shows one enrichment result at a time: PTM-SEA, Kinase GSEA, or MEA. Its volcano and sortable table summarize sequence sets by normalized enrichment score and GSEA FDR. Selecting a row or sequence-set option updates the running-enrichment curve and ranked site table. Each site row reports the original rank, running enrichment score, selected-set NES, and leading-edge assignment. Clicking a curve hit selects its exact site row or rows; clicking a site row continues into the existing Protein detail view at that site. Applying the GSEA selection filters the other linked views to the selected full or leading-edge site set. The GSEA FDR is independent of the site-level FDR and fold-change controls.

The volcano uses the selected method's effect and FDR. The protein-versus-site scatter always uses total-protein log2 fold change on the x-axis and original phosphosite log2 fold change on the y-axis, including for DPU and CF-DPU.

## Protein detail

Protein detail lists sites for the displayed contrast. It shows only sites passing the shared statistical, estimate-type, structural, and active UpSet intersection filters by default. Turn off **UpSet selection** in the shared controls to remove only the intersection filter. **Show all sites** restores measured sites without a passing result while retaining the displayed contrast, estimate-type selection, explicit structural filters, and any active UpSet selection.

The right side provides three linked views:

- **3D structure** shows effect-colored PTM markers on the prepared AlphaFold model. Representations are Cartoon, Backbone trace, and Surface. The protein can be colored by pLDDT, exposure, predicted region, exact UniProt feature type, N-to-C position, or a neutral color.
- **N-to-C lollipop** places method effects along the full protein sequence. Dashed sticks and open heads indicate LOD-imputed estimates; a baseline cross marks a measured site without an estimable effect. UniProt features and residue-by-residue Exposure, Region, and pLDDT tracks share the sequence axis. Hover text reports exact values and the AlphaFold fragment.
- **PAE** lazy-loads the displayed model's predicted aligned error matrix. Darker cells indicate more confident relative placement and lighter cells indicate more uncertain placement; dotted guides mark the selected site. PAE is not per-residue confidence, exposure, statistical evidence, or functional importance.

Sites without a mapped structure residue remain available in the table, N-to-C plot, and abundance view. `matched` structural context means that the experimental residue agrees with the AlphaFold model residue; it does not imply exposure, high confidence, significance, or biological importance.

## Site abundance

Site abundance pairs the protein's site table with sample-level boxplots. Hovering a site previews its abundance, leaving restores the selected site, and clicking opens the site in Protein detail's 3D view. DPA and DPU show aligned enriched-site and total-protein measurements. CF-DPU also shows the corrected site-minus-protein values used by the model. Every dot is a sample, and missing values remain missing rather than becoming zero.

## Browser data and network access

The viewer reads only the prepared Parquet tables, static plot backgrounds, compressed structures, PAE files, and residue-context files served from its own origin. It does not fetch analysis data from UniProt, STRING, AlphaFold, or a CDN. Prepared UniProt and STRING URLs are ordinary user-clicked external links.
