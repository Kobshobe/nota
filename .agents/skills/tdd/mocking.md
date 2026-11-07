# When to Mock

Mock only at **system boundaries**:

- External APIs (payments, email, etc.)
- Databases (sometimes — prefer a test database)
- Time/randomness
- The filesystem (sometimes)

Don't mock:

- Your own classes/modules
- Internal collaborators
- Anything you control

## Design for mockability

At system boundaries, design interfaces that are easy to mock:

**1. Use dependency injection**

Pass external dependencies in instead of creating them inside:

```typescript
// easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Prefer SDK-style interfaces over a generic fetcher**

Create a specific function per external operation instead of one generic function with conditional logic:

```typescript
// good: each function can be mocked independently
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// bad: mocking requires conditional logic inside the mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

The SDK approach means:

- Every mock returns a specific shape
- No conditional logic in test setup
- It's easier to see which endpoints a test touches
- Every endpoint is type-safe
