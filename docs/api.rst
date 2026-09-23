Python API
==========

The CLI is the primary entry point. These Python functions are available for applications that need to prepare or serve method directories programmatically. The default output path and method set are documented in their signatures.

Preparation
-----------

.. automodule:: proptm3d.prepare
   :members: prepare_stats, prepare_gsea, is_prepared, clean_methods

Static serving
--------------

.. automodule:: proptm3d.webapp
   :members: create_server, serve

Structural context cache
------------------------

.. automodule:: proptm3d.structural_context_cache
   :members: proteome_for_organism, cache_statuses, precompute_archive_context, load_precomputed_contexts
