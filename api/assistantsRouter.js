// api/assistantsRouter.js
import OpenAI from "openai";
import { consultarGastosPorCategoria } from "./gastos.js";
import { registrarMensagemNoSheets } from "./sheets.js"; // ou "registro.js", se preferir

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const assistantId = "asst_0v3ZAgYaYnm22VfBEwgBgbMb"; // ex: asst_12345

const threadMap = new Map(); // memória temporária por número

export async function processarMensagemZyra(userNumber, mensagem) {
  try {
    // Cria ou recupera thread do número
    let threadId = threadMap.get(userNumber);
    if (!threadId) {
      const novaThread = await openai.beta.threads.create();
      threadId = novaThread.id;
      threadMap.set(userNumber, threadId);
    }

    // Envia a mensagem do usuário
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: mensagem,
    });

    // Roda o assistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    // Aguarda a execução terminar
    let status = "queued";
    while (status !== "completed" && status !== "requires_action") {
      const statusCheck = await openai.beta.threads.runs.retrieve(threadId, run.id);
      status = statusCheck.status;
      await new Promise((res) => setTimeout(res, 1000));
    }

    // Se a Zyra pedir para chamar uma função
    if (status === "requires_action") {
      const toolCall = (await openai.beta.threads.runs.retrieve(threadId, run.id)).required_action.submit_tool_outputs.tool_calls[0];
      const nomeFuncao = toolCall.function.name;
      const argumentos = JSON.parse(toolCall.function.arguments);

      let respostaFinal;

      if (nomeFuncao === "consultarGastos") {
        const total = await consultarGastosPorCategoria({
          userNumber: argumentos.numero,
          categoria: argumentos.categoria || "",
          periodo: argumentos.periodo || "mes_atual",
        });
        respostaFinal = `Você gastou aproximadamente R$ ${total.toFixed(2)} nesta categoria.`;
      }

      if (nomeFuncao === "registrarGasto") {
        await registrarMensagemNoSheets({
          numero: argumentos.numero,
          texto: argumentos.texto,
        });
        respostaFinal = `Tudo certo! Registrei esse gasto no seu controle financeiro. Deseja ver um resumo do mês?`;
      }

      // Envia a resposta de volta para o Assistant
      await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
        tool_outputs: [
          {
            tool_call_id: toolCall.id,
            output: respostaFinal,
          },
        ],
      });

      // Aguarda finalização
      let finalizado = false;
      while (!finalizado) {
        const statusCheck = await openai.beta.threads.runs.retrieve(threadId, run.id);
        if (statusCheck.status === "completed") finalizado = true;
        else await new Promise((res) => setTimeout(res, 1000));
      }
    }

    // Pega a última mensagem da Zyra
    const mensagens = await openai.beta.threads.messages.list(threadId);
    const respostaZyra = mensagens.data[0]?.content[0]?.text?.value || "Desculpe, não consegui gerar uma resposta.";

    return respostaZyra;

  } catch (erro) {
    console.error("Erro no processarMensagemZyra:", erro);
    return "Ocorreu um erro ao processar sua mensagem. Tente novamente mais tarde.";
  }
}
