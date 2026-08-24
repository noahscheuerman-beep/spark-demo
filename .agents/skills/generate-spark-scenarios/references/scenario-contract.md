# Spark scenario contract

## Fixed fictional account

- Customer: Noah, `CUS-1048`
- Vehicle: 2026 Spark One, Silverline
- Charge: 78%
- Estimated range: 241 miles
- Software: v12.8.4
- Warranty: active
- Eligible order: `ORD-1842`, Spark Home Connector, delivered 10 days ago, 30-day return window
- Ineligible order: `ORD-1759`, All-Weather Interior Mats, delivered 42 days ago, 30-day return window

## Supported domains

- `charging`
- `vehicle`
- `orders`
- `returns_refunds`
- `general_escalation`

## Available routes

- `vehicle_charging`
- `orders_returns`
- `general_support`

## Available tools

- `get_vehicle_status`
- `diagnose_home_charger`
- `get_recent_orders`
- `check_return_eligibility`
- `create_return_request`
- `escalate_to_human`

## Behavior specs

- `preserve-action-intent-during-routing`: Preserve explicit return, refund, replacement, cancellation, and escalation requests when the customer also describes a technical problem.
- `confirm-before-consequential-action`: Require explicit confirmation before creating a pending return request or human escalation.
- `ground-account-claims-in-tools`: Use account tools before making claims about vehicle state, orders, or eligibility.
- `stay-within-safe-troubleshooting`: Give basic charging diagnostics without asking the customer to open electrical equipment.

## Manifest record

Each record must contain:

- `id`: stable lowercase hyphenated identifier
- `title`: short internal title
- `domain`: one supported domain
- `goal`: the customer's actual desired outcome
- `variationKey`: concise combination of distinguishing scenario facets
- `accountScenario`: one of `everyday`, `faulty_charger`, `delayed_replacement`, or `refund_pending`
- `userTurns`: two to four complete customer turns
- `expected.routeBaseline`: expected route for `baseline-v1`
- `expected.routeImproved`: expected route for `improved-v1`
- `expected.tools`: ordered or partial ordered tool list
- `expected.outcome`: observable final state
- `behaviorSpecs`: one or more applicable behavior specs
- `tags`: searchable internal labels

The manifest must stay valid JSON and must contain no comments.
