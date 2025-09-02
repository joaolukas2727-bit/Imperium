// api/webhook.js
export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    try {
      const data = req.body || {};
      console.log("📩 Webhook payload:", JSON.stringify(data, null, 2));

      const value = data?.entry?.[0]?.changes?.[0]?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const msg = value?.messages?.[0];

      // Só responde se for texto e estivermos na janela de 24h
      if (msg?.type === "text" && phoneNumberId && ACCESS_TOKEN) {
        const from = msg.from; // número do remetente
        await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            text: { body: "✅ Recebido!" },
          }),
        });
      }

      return res.status(200).json({ status: "ok" });
    } catch (e) {
      console.error("Erro no webhook:", e);
      return res.status(200).json({ status: "ok" });
    }
  }

  return res.status(405).send("Method Not Allowed");
}
