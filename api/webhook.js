// api/webhook.js
import express from "express";
import { processarMensagemZyra } from "./assistantsRouter.js";

const app = express();
app.use(express.json());

app.all("/webhook", async (req, res) => {
  // Verificação do webhook (GET da Meta)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === "joaolukas2710") {
      console.log("✅ Webhook verificado com sucesso.");
      return res.status(200).send(challenge);
    } else {
      console.log("❌ Token de verificação incorreto.");
      return res.sendStatus(403);
    }
  }

  // Processamento normal (mensagens do WhatsApp via POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      const entrada = body?.messages?.[0];
      if (!entrada) return res.sendStatus(400);

      const numero = entrada.from;
      const mensagem = entrada.text?.body;
      if (!numero || !mensagem) return res.sendStatus(400);

      console.log(`📩 Mensagem recebida de ${numero}: ${mensagem}`);

      const resposta = await processarMensagemZyra(numero, mensagem);
      await enviarMensagemWhatsApp(numero, resposta);

      res.sendStatus(200);
    } catch (erro) {
      console.error("❌ Erro no webhook:", erro);
      res.sendStatus(500);
    }
  } else {
    res.sendStatus(405); // Método não permitido
  }
});

// Mock de envio de resposta (substituir pela integração real depois)
async function enviarMensagemWhatsApp(numero, mensagem) {
  console.log(`💬 Enviando para ${numero}: ${mensagem}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook rodando na porta ${PORT}`);
});

export default app;


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor webhook rodando na porta ${PORT}`);
});
