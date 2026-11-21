# Topology change: integration (admin "Tích hợp")

Integration now keeps `tenant_projection` (store names), so its queue must also receive the store events. In
`pbl-infra/terraform/events-topology.json` (regenerate with `scripts/export-topology.ts`; `libs/contracts/src/topology.ts`
already has it), under `queues.integration.platform` add:

```json
"platform.tenant.created",
"platform.tenant.updated"
```

so that the list becomes:

```json
"integration": {
  "platform": [
    "platform.branch.created",
    "platform.branch.updated",
    "platform.tenant.created",
    "platform.tenant.updated",
    "platform.tenant.status_changed",
    "platform.subscription.changed"
  ]
}
```

(the `catalog`, `inventory` and `sales` producers keep their lists). No new event types and no new topics. The branch
events were already subscribed; integration did not handle them before this change.
