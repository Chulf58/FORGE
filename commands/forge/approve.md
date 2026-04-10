Approve the pending FORGE gate.

Read `.pipeline/gate-pending.json`. 

If the file exists and `status` is `"pending"`:
1. Update the file: set `"status": "approved"`, add `"approvedAt"` with current ISO date
2. If `gate` is `"gate1"`: print "Gate 1 approved. Run /forge:implement to start implementation."
3. If `gate` is `"gate2"`: print "Gate 2 approved. Run /forge:apply to apply the changes."

If the file exists and `status` is already `"approved"`:
- Print "Gate already approved. Run /forge:implement (gate1) or /forge:apply (gate2) to continue."

If the file does not exist:
- Print "No pending gate to approve."
