# One permitted harness correction

The original invocation exited 1 before collecting tests. The moved scratch config caused the inherited relative main path to resolve under the evidence directory, not apps/credential-tests. Miniflare also named the auxiliary module relative to the process working directory, yielding a ../../ module name. Workerd rejected that name with "can't use '..' to break out of starting directory".

The corrected config uses an absolute existing main path and the supported public auxiliary modulesRoot option set to the bundle directory. No source, bindings, D1 ID, DO namespace, cancellation adapter, assertions, samples or deadlines change. Original log/config/metafile/bundle are retained. This uses the one allowed corrected rerun. No further rerun is authorized.
