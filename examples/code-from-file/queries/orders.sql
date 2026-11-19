-- Orders report: one row per active customer.
-- Totals and counts come from one pass over orders.

SELECT c.name,
       totals.amount,
       totals.n
FROM customers AS c
  JOIN (SELECT customer_id,
               SUM(total) AS amount,
               COUNT(*) AS n
        FROM orders
        GROUP BY customer_id) AS totals
    ON totals.customer_id = c.id
WHERE c.active;
