// api/webhook.js
export default function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send("Forbidden");
    }
  }

  if (req.method === "POST") {
    console.log("📩 Webhook recebido:", JSON.stringify(req.body, null, 2));
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).send("Method Not Allowed");
}
