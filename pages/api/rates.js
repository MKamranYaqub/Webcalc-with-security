import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "data", "rates.json");

export default function handler(req, res) {
  if (req.method === "GET") {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return res.status(200).json(data);
  }
  if (req.method === "PUT") {
    try {
      fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), "utf8");
      return res.status(200).json({ message: "Rates updated successfully" });
    } catch (err) {
      return res.status(500).json({ error: "Failed to update file" });
    }
  }
  res.setHeader("Allow", ["GET", "PUT"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
