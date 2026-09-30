# Explore prepared results

Opening a multi-method prepared root or bundle first shows an analysis overview with sample groups, preparation provenance, per-method coverage, and links to the DPA, DPU, and CF-DPU viewers. A single-method bundle opens its viewer directly.

## Shared filtering

The shared filtering panel places each control beside the UpSet it changes. B occupies the left column at the combined height of A and C, which stack in the right column; B's plot scrolls inside that height. On narrower screens the cards stack B, A, C. **Hide filters** collapses the A/B/C plots and controls without changing their selections. The header keeps a short selected-site count, A/B/C states and any active Estimate, Exposure or Region choices, while the displayed-contrast selector and protein search remain visible and usable. A and B are independent inputs to C:

```text
Site FDR + |log2FC| → A: significant sites by contrast ──────┐
GSEA FDR + leading edge → B: sequence_set memberships ──────┼→ C → selected sites
Estimate / Exposure / Region ──────────────────────────────┘
```

| State | A: contrast selection | B: sequence_set selection |
| --- | --- | --- |
| Off | No contrast or site-significance filtering | No sequence-set filtering, including unassigned sites |
| All | Union of significant sites across all contrasts | Union of sites in all eligible sequence_sets |
| Named set | Whole contrast's significant sites, including shared sites | Whole sequence_set, including shared sites |
| Exact intersection | Sites belonging to exactly the marked contrasts | Sites belonging to exactly the marked sequence_sets |

Click a horizontal set-size bar, its count, or its row name for a whole set; the name remains an easy target even when the bar is tiny. Row names also support Enter or Space from the keyboard. Click an intersection bar, its count, or its matrix column for an exact membership combination: marked sets are required and every other enabled set in that plot must be absent. Click the selected column again to return to All. Intersections are calculated over the complete set universe. In A and B, 50 observed combinations appear per page with scrollable rows. Their **Dots per intersection** dropdown narrows displayed columns: 1 dot means exclusive to one set, 2 dots means shared by exactly two sets, and so on; All intersections restores the full display. The dropdown offers only counts with existing intersections across all pages. If a chosen count disappears after an upstream change, the display returns to All intersections. C shows combinations that pass every active Estimate, Exposure and Region choice and at least one active A/B selection (when present). For example, with A, B and all three properties enabled, it shows A-only, B-only and A+B columns that pass all three properties. C has no dot-count dropdown or pagination. This display restriction does not change C's union, set sizes or memberships. Search, dot count and paging never redefine memberships or change the active site selection, even if its column is hidden. In View All, whole-set bars retain their complete counts, including shared sites. In a named-set Selected view, left bars instead show overlap counts summed across the matching intersection combinations; the chosen set appears first and zero-overlap rows are hidden. The dot-count choice changes these plotted counts, but paging does not.

Each UpSet plot has a **View: Selected / All** toggle in its top-left corner. Clicking a horizontal set bar selects the whole set and, in Selected view, displays only intersection columns containing that set, with conditional overlap sizes at left. Clicking a top intersection bar or its count selects that exact intersection and displays only its member-set rows. The matrix remains a selection target. View All restores all rows, columns and global set-size bars without changing the site selection; switching back to Selected restores the focused display. Off and All selections have no focused display. Hidden rows and columns do not alter the underlying whole-set membership or exact intersections, which always use the complete set universe.

A sorts contrast rows by whole-set size in View All. B sorts sequence_set rows by whole-set size when all intersections are shown; with a dot count selected, it sorts by the largest exact intersection of that size containing each set, then by the total of those intersections. In a named-set Selected view, all three UpSets put the chosen set first and sort remaining nonzero rows by their conditional overlap counts. **Find sequence set** brings matching rows to the top, shows only intersection columns containing a match, and focuses the first matching curve. Search and row sorting do not change B's site selection or underlying whole-set counts. C keeps its five filter rows in semantic order in View All. Horizontal bars in C also select the whole filter set, including sites shared with other enabled filters. Reclicking the selected bar or Clear C returns to union. Count labels stay horizontal outside the bars, including very small sets.

**C defaults to All: the union of enabled filter sets, not their intersection.** For example, with A = All and Exposure = Exposed, C includes significant sites **or** exposed sites. Choose the C column containing both rows to require both. The display omits the Exposure-only column when A is active; the full union still includes those sites. Disabled rows remain labelled but do not participate in the union or exact intersections. With every filter disabled, C returns all measured sites.

A uses strict comparisons: site FDR below the cutoff and absolute log2FC above it. These controls sit directly above A's plot. B has GSEA FDR, enrichment-result selection, sequence-set search, a Running curve for selector and leading-edge mode. The running-curve selector changes only which single set's curve appears in the GSEA view; it does not filter sites. C has Estimate, Exposure and Region. Defaults are FDR 0.05, |log2FC| 1, A All, B Off, and C All. Estimate, Exposure and Region default to All (disabled). GSEA FDR (default 0.05) decides which sets enter B, not which individual sites pass. Leading edge changes B's memberships without changing eligibility.

Each A/B card contains its own Off and All buttons plus its selection label/count. C's card contains its selection label/count and **Show all sites**; **Clear C selection** appears only while an explicit C intersection is selected. Clear C returns to union while retaining A, B and control values. Show all suspends the complete hierarchy and filter editing, retaining selections for restoration. The panel's top bar shows the hide/show button and a compact selected-site count with A/B/C states and active property choices. Contrast display and protein search remain available when the UpSets are collapsed; reopen them to change sequence-set search or any site filter.

Threshold and upstream filter changes reset an explicit C intersection to All with a notice. A named/exact selection stays selected if new site thresholds make it empty. A named B selection survives GSEA-FDR changes while eligible; removing that set or changing the eligible universe beneath an exact B intersection resets B to All. Result/contrast changes reset active B to All, but preserve B Off. A successfully loaded B with no eligible sets is empty; loading, missing and failed payloads are labelled separately and never silently bypass an active B filter.

**Contrast shown in plots and GSEA is not A's selection.** It changes which contrast-dependent values are displayed without changing A's selected site set. Find protein narrows the displayed protein list without changing A, B or C membership. One enrichment result is active at a time. The set chosen in Running curve for determines the curve and its NES independently of B's aggregate selection; selecting a named B set also shows its curve. Aggregate selections retain an eligible curve choice or use the first eligible set in FDR/absolute-NES order.

C produces one deduplicated set of protein/site identities for every workspace. Views only project it onto their protein or contrast; none reapplies significance, GSEA or structural filtering afterward. Search changes navigation/display, not membership counts. Statistics-only preparations omit B and the GSEA controls, retaining A and C.

Exposure and Region are independent AlphaFold-derived annotations. Exposed/Buried and IDR/Structured sets exclude sites without matching model context; another enabled C operand can still select those sites. The How to read this panel explains the annotations and colors.

## Find proteins

The Find proteins workspace has four views in a GSEA preparation and three in a statistics-only preparation:

- **All contrasts** summarizes C-selected measured, tested, significant, upregulated, and downregulated sites across the method's contrasts. Matching-site labels identify the selected residues. Click a protein row to open its first matching site. Significant-site intersections now live in A in the shared filtering panel, not in this workspace.
- **Single contrast** places the contrast-specific protein table beside a volcano and a total-protein-versus-original-site fold-change scatter. Interactive overlays show C-selected sites: red and blue points pass in the contrast context, while amber points are selected but do not pass in this contrast. Hover a protein row to isolate that protein's selected points temporarily; leaving the row restores the complete selection overlay.
- **Single contrast sequlogos** shows the same selected-site overlays plus Up, Down, and Up-minus-Down amino-acid frequency logos. Logos use C-selected sites with valid sequence windows and nonzero effects in the contrast context; they do not reapply site FDR or log2FC cutoffs. Plot points open the corresponding protein and site.
- **GSEA** shows one enrichment result at a time: PTM-SEA, Kinase GSEA, or MEA. Its volcano and sortable table summarize sequence sets by normalized enrichment score and GSEA FDR. Selecting a row or using Running curve for changes the full running-enrichment curve, independently of B. The site table follows C and shows contrast-specific log2FC and site FDR; members of the displayed set additionally have one-based rank, running ES, set NES and leading-edge annotation. Missing values appear as `—`. Selected curve hits are highlighted separately from leading edge without trimming the full curve. Clicking a curve hit selects its available table rows; clicking a site row opens Protein detail. Use B for sequence-set filtering, not the running-curve selector.

The volcano uses the selected method's effect and FDR. The protein-versus-site scatter always uses total-protein log2 fold change on the x-axis and original phosphosite log2 fold change on the y-axis, including for DPU and CF-DPU.

Orange “Selected, outside thresholds” points have coordinates but fail site FDR and/or absolute log2FC in the contrast context. This is a significance classification, not another filter. Sites without required coordinates cannot appear as points: the notes below the plots reconcile selected and plotted counts, and those sites remain in the protein table with missing values. Missing effects likewise have no Up/Down logo assignment.

## Protein detail

Protein detail lists C-selected sites for the chosen protein and contrast. Missing statistical values stay missing. Show all sites in C restores every measured site while remembering the complete filtering hierarchy; toggling it off restores that hierarchy.

The right side provides three linked views:

- **3D structure** shows effect-colored PTM markers on the prepared AlphaFold model. Representations are Cartoon, Backbone trace, and Surface. The protein can be colored by pLDDT, exposure, predicted region, exact UniProt feature type, N-to-C position, or a neutral color.
- **N-to-C lollipop** places method effects along the full protein sequence. Dashed sticks and open heads indicate LOD-imputed estimates; a baseline cross marks a measured site without an estimable effect. UniProt features and residue-by-residue Exposure, Region, and pLDDT tracks share the sequence axis. Hover text reports exact values and the AlphaFold fragment.
- **PAE** lazy-loads the displayed model's predicted aligned error matrix. Darker cells indicate more confident relative placement and lighter cells indicate more uncertain placement; dotted guides mark the selected site. PAE is not per-residue confidence, exposure, statistical evidence, or functional importance.

Sites without a mapped structure residue remain available in the table, N-to-C plot, and abundance view. `matched` structural context means that the experimental residue agrees with the AlphaFold model residue; it does not imply exposure, high confidence, significance, or biological importance.

## Site abundance

Site abundance pairs the protein's site table with sample-level boxplots. Hovering a site previews its abundance, leaving restores the selected site, and clicking opens the site in Protein detail's 3D view. DPA and DPU show aligned enriched-site and total-protein measurements. CF-DPU also shows the corrected site-minus-protein values used by the model. Every dot is a sample, and missing values remain missing rather than becoming zero.

## Browser data and network access

The viewer reads only the prepared Parquet tables, static plot backgrounds, compressed structures, PAE files, and residue-context files served from its own origin. It does not fetch analysis data from UniProt, STRING, AlphaFold, or a CDN. Prepared UniProt and STRING URLs are ordinary user-clicked external links.
