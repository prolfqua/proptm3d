Python API
==========

The CLI is the primary entry point. These Python functions are available for applications that need to prepare, bundle, or serve method directories programmatically. Output roots are explicit; method defaults are documented in the function signatures.

Preparation
-----------

.. automodule:: proptm3d.prepare
   :members: prepare_stats, prepare_gsea, is_prepared

Prepared roots and bundles
--------------------------

.. automodule:: proptm3d.prepared_root
   :members: available_methods, clean_prepared_root

.. automodule:: proptm3d.bundle
   :members: bundle_prepared_root, validate_bundle

Static serving
--------------

.. automodule:: proptm3d.webapp
   :members: create_server, serve

Structural context cache
------------------------

.. automodule:: proptm3d.structural_context_cache
   :members: proteome_for_organism, cache_statuses, precompute_archive_context, load_precomputed_contexts
