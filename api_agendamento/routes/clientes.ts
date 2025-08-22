import { PrismaClient } from "@prisma/client"
import { Router } from "express"
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { isValid } from "date-fns"
import { enviarCodigoEmail } from "../utils/enviarEmail"
import { gerarCodigoVerificacao } from "../utils/gerarCodigo"

const prisma = new PrismaClient()
const router = Router()

// Schema de criação de cliente
const clienteSchema = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  celular: z.string().min(10),
  cpf: z.string().min(11),
  nascimento: z.string().refine(data => isValid(new Date(data)), {
    message: "Data de nascimento inválida"
  }),
  senha: z.string(),
})

// Validação da senha (regra simples)
function validaSenha(senha: string) {
  const erros: string[] = [];
  if (senha.length < 6) erros.push("Mínimo 6 caracteres");
  if (!/[A-Z]/.test(senha)) erros.push("Pelo menos 1 letra maiúscula");
  return erros;
}


// POST /clientes/registrar
router.post("/registrar", async (req, res) => {
  const validacao = clienteSchema.safeParse(req.body)
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors.map(e => e.message).join("; ") })
  }

  const errosSenha = validaSenha(validacao.data.senha)
  if (errosSenha.length > 0) {
    return res.status(400).json({ erro: errosSenha.join("; ") })
  }

  const { nome, email, celular, cpf, nascimento, senha } = validacao.data
  const codigo = gerarCodigoVerificacao()
  const hash = bcrypt.hashSync(senha, 12)

  try {
    const novo = await prisma.usuario.create({
      data: {
        nome,
        email,
        celular,
        cpf,
        nascimento: new Date(nascimento),
        senha: hash,
        tipo: "CLIENTE",
        verificado: false,
        codigoEmail: codigo,
      },
    })
    try {
      await enviarCodigoEmail(email, codigo)
    } catch (e) {
      await prisma.usuario.delete({ where: { id: novo.id } }) // apaga o cliente criado
      return res.status(500).json({ erro: "Erro ao enviar email de verificação" })
    }

    res.status(201).json({ mensagem: "Código enviado. Verifique seu e-mail para validar." })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ erro: error })
    }
    console.log(error)
    res.status(500).json({ erro: error })
  }
})

router.post("/validar-email", async (req, res) => {
  const { email, codigo } = req.body

  if (!email || !codigo) {
    return res.status(400).json({ erro: "E-mail e código são obrigatórios" })
  }

  try {
    const cliente = await prisma.usuario.findFirst({ where: { email, tipo: "CLIENTE" } })

    if (!cliente) {
      return res.status(404).json({ erro: "Cliente não encontrado" })
    }

    if (cliente.verificado) {
      return res.status(400).json({ erro: "E-mail já foi verificado" })
    }

    if (cliente.codigoEmail !== codigo) {
      return res.status(400).json({ erro: "Código inválido" })
    }

    await prisma.usuario.update({
      where: { id: cliente.id },
      data: { verificado: true, codigoEmail: null },
    })

    res.json({ mensagem: "E-mail verificado com sucesso!" })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao verificar e-mail" })
  }
})


// GET /clientes
// GET /clientes
router.get("/", async (req, res) => {
  try {
    const { nome } = req.query;

    const where = {
      tipo: "CLIENTE",
      ...(nome
        ? { nome: { contains: String(nome), mode: "insensitive" } }
        : {}),
    };

    // Monta a query dinamicamente: limita a 10 apenas quando for autocomplete (com nome)
    const query: any = {
      where,
      orderBy: { nome: "asc" },
      ...(nome ? { take: 10 } : {}), // << só limita no autocomplete
    };

    const clientes = await prisma.usuario.findMany(query);
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar clientes" });
  }
});


// GET /clientes/:id
router.get("/:id", async (req, res) => {
  try {
    const cliente = await prisma.usuario.findFirst({
      where: { id: req.params.id, tipo: "CLIENTE" },
    })

    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado" })
    res.json(cliente)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar cliente" })
  }
})

// DELETE /clientes/:id
router.delete("/:id", async (req, res) => {
  try {
    await prisma.usuario.delete({ where: { id: req.params.id } })
    res.json({ mensagem: "Cliente excluído com sucesso" })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao excluir cliente" })
  }
})

export default router
