// api/webhook.js

import express from "express";
import { processarMensagemZyra } from "./assistantsRouter.js";

const app = express();
app.use(express.json());

app.all("/webhook", async (req, res) => {
  // Verificação do Webhook (GET da Meta)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === "joaolukas2710") {
      console.log("✅ Webhook verified successfully.");
      return res.status(200).send(challenge);
    } else {
      console.log("❌ Invalid verification token.");
      return res.sendStatus(403);
    }
  }

  // Processamento normal (mensagens do WhatsApp via POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      const entry = body?.messages?.[0];
      if (!entry) return res.sendStatus(400);

      const number = entry.from; // Ex: 553499999999
      const message = entry.text?.body; // Texto da mensagem

      if (!number || !message) return res.sendStatus(400);

      console.log(`📩 Message received from ${number}: ${message}`);

      const response = await processarMensagemZyra(number, message);

      await sendMessageWhatsApp(number, response);

      res.sendStatus(200);
    } catch (error) {
      console.error("❌ Error in webhook:", error);
      res.sendStatus(500);
    }
  } else {
    res.sendStatus(405); // Método não permitido
  }
});

// Função simulada de envio (substituir por envio real via API depois)
async function sendMessageWhatsApp(number, message) {
  console.log(`💬 Sending to ${number}: ${message}`);
  // Aqui você conecta com sua API real de envio de mensagens
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on port ${PORT}`);
});

export default app;

