# 008 queued-sequence advisor checkpoint

Status: diagnostic inconclusive, no permanent source delta. 008 remains unaccepted.

The advisor read the complete diagnostic report and the failure/preceding-successor boundaries in the actual log. All 37 restored source hashes and all 37 entry archive members independently match the retained authority-batch candidate. Evidence is copied under MAIN `plans/evidence/artifacts/008/queued-sequence-advisor/`, with `independent-restoration.json`. MAIN source remains untouched.

The instrumented original-order sequence reports nine passes, then generation-2/missing-fence test timeout at 5000ms plus an isolation error. Forty-two unrelated cases are filtered. Five selected cases, including queued configuration, are not reached. This is not the same failure location as the two uninstrumented 12-pass sequences.

There are 227 runtime stage events, but no queued-test entry. For the failing test, both successor alarm completions are observed, and no retirement entry is observed. The deliberate predecessor join hold is ended by the actual reset and does not independently prove a leaked wait. The exact pending test-body continuation remains unknown. Added logging is a possible perturbation, not an established cause. No source fix follows from these observations.

One smaller diagnostic resume is authorized in the existing execution worktree. The same verified model/provider and medium reasoning are required. Only temporary scalar boundary logs in the existing generation-2/missing-fence and queued-configuration test bodies may change. Runtime/fixture implementation stays byte-identical. Start timing at actual function entry, mark the existing major awaits and cleanup boundaries, then run the same original-order bounded selection once. This avoids global runtime logging and gives visibility if either affected case fails first. No new waits, timers, queries, widened deadlines, assertion changes, disposal, permanent patch or full-suite retry. Restore all 37 hashes afterward. If this still fails before both instrumented cases or provides no actionable evidence, stop and report rather than extending an open-ended instrumentation campaign.

Full product suite and the original five sequential aggregates remain not run on completed final bytes. No integration, commit, deployment, replay/refund or production activation is authorized.
