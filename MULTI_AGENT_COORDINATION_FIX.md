# Multi-Agent Coordination Fix

## Problem
The system was designed with hardcoded assumptions that channels would only have 1-2 agents, causing coordination failures when 3+ agents are active.

## Issues Fixed

### 1. Message Routing Bug (services/api/src/routers/messages.ts)
**Issue**: When a message contained multiple @mentions (e.g., "@agent-alpha @agent-beta help!"), only the FIRST mentioned agent was triggered.

**Root Cause**: Line 108 used `.find()` which returns only the first match:
```typescript
// OLD (buggy)
const mentionedAgent = agentMembers.find((a) => mentionedTokens.includes(a.handle));
```

**Fix**: Changed to `.filter()` to get ALL mentioned agents:
```typescript
// NEW (fixed)
const mentionedAgents = agentMembers.filter((a) => mentionedTokens.includes(a.handle));
```

### 2. Missing Agent Awareness (services/api/src/routers/messages.ts, services/agent-runtime/src/handler.ts)
**Issue**: Agents had no knowledge of other agents in the channel, preventing coordination.

**Fix**: Added `otherAgentsInfo` to the event payload containing:
- Agent ID
- Name
- Handle (@mention name)
- Role description

System prompt now includes:
```
## Other agents in this channel
- @handle: Name — Role description
...

You can @mention other agents to delegate tasks that match their expertise,
collaborate on complex requests, or ask for help when their capabilities are
more relevant than yours.
```

### 3. Triage Not Excluding Mentioned Agents (services/api/src/routers/messages.ts)
**Issue**: When agents were explicitly @mentioned, other agents with "relevant" trigger would still run triage, creating duplicate/conflicting responses.

**Fix**: Modified triage filter to exclude agents that were already mentioned:
```typescript
const triageAgents = agentMembers.filter(
  (a) => a.id !== ctx.actorId &&
         !mentionedAgentIds.has(a.id) &&  // NEW: exclude mentioned agents
         a.config.triggers.some((t) => t.kind === "relevant" && t.enabled)
);
```

### 4. Direct Channel Coordination (services/api/src/routers/messages.ts)
**Issue**: Direct channels (group DMs) with 3+ agents didn't share agent context between agents.

**Fix**: Added `otherAgentsInfo` to direct channel runs, consistent with group channels.

### 5. Scheduled Run Coordination (services/agent-runtime/src/scheduled.ts)
**Issue**: Scheduled runs lacked awareness of other agents in the target channel.

**Fix**: Added `getOtherAgentsContext()` function that loads channel members and builds coordination context for scheduled runs.

## Files Changed

1. **services/api/src/routers/messages.ts**
   - Changed `.find()` to `.filter()` for multiple mention handling
   - Added `mentionedAgentIds` Set for efficient exclusion tracking
   - Added `otherAgentsInfo` to all agent run payloads
   - Modified triage logic to exclude mentioned agents

2. **services/agent-runtime/src/handler.ts**
   - Added `OtherAgentInfo` type
   - Added `otherAgentsContext()` function
   - Updated system prompt building to include coordination context
   - Passed context to both triage classifier and main agent

3. **services/agent-runtime/src/scheduled.ts**
   - Added `getOtherAgentsContext()` function
   - Updated `runScheduled()` to load and include other agent context
   - Added Member type import for agent filtering

4. **services/agent-runtime/src/persist.ts**
   - No changes needed - already scoped correctly per-agent

## Testing

Added test files:
- `services/api/src/routers/messages-multi-agent.test.ts`
- `services/agent-runtime/src/multi-agent-coordination.test.ts`

Tests cover:
- Multiple @mention extraction
- All mentioned agents being triggered
- Triage exclusion of mentioned agents
- Agent context formatting in system prompts
- 3+ agent coordination scenarios

## Backwards Compatibility

All changes are backwards compatible:
- `otherAgentIds` and `otherAgentsInfo` are optional in events
- Code gracefully handles undefined values
- Existing 2-agent channels continue to work unchanged
