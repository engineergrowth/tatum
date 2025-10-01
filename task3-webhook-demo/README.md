## Application

A customer would use this webhook to get instant, real-time notifications about transactions. It is far more efficient than constantly asking the API if anything new has happened.

To plug this into their backend, they'd start by exposing a dedicated API endpoint, something like https://api.their-app.com/webhooks/tatum, and provide that public URL when creating the subscription. This endpoint's job is to listen for the POST requests sent by Tatum.

When a notification arrives, the first thing their backend code should do for security is check the X-Tatum-Signature header. By hashing the raw request body with their secret key and comparing it to the signature in the header, they can confirm the request is genuinely from Tatum and hasn't been faked.

Once the webhook is verified, they can parse the JSON payload to get the transaction details. From there, they can kick off any number of backend processes: updating a user's balance in the database, confirming a customer's payment for an order, or sending a "deposit confirmed" email to the end-user.

Overall, it's a powerful tool for building reactive, event-driven applications on the blockchain without the overhead of constant polling.