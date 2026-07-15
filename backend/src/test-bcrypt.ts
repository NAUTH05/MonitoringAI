import bcrypt from 'bcryptjs';
async function test() {
  try {
    const hashed = await bcrypt.hash('Admin@123', 10);
    const isValid = await bcrypt.compare('Admin@123', hashed);
    console.log("SUCCESS: Bcrypt works, comparison is:", isValid);
  } catch (err) {
    console.error("ERROR: Bcrypt failed:", err);
  }
}
test();
