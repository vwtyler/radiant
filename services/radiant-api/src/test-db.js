const { pool } = require("./db");
const token = "cbd8182b6be3acfb3e055962a14155f8c218170f24b263748456b36b8beb39bf";
pool.query(
  `SELECT id, email, role, dj_id FROM app_admin_invitations WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
  [token]
).then(result => {
  console.log("Rows found:", result.rows.length);
  console.log("Rows:", result.rows);
  process.exit(0);
}).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
