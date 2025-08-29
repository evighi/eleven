import { PrismaClient, TipoUsuario } from "@prisma/client"
import { Router } from "express"
import bcrypt from "bcrypt"
import { z } from "zod"
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
  nascimento: z.string().refine((data) => isValid(new Date(data)), {
    message: "Data de nascimento inválida",
  }),
  senha: z.string(),
})

// Validação da senha (regra simples)
function validaSenha(senha: string) {
  const erros: string[] = []
  if (senha.length < 6) erros.push("Mínimo 6 caracteres")
  if (!/[A-Z]/.test(senha)) erros.push("Pelo menos 1 letra maiúscula")
  return erros
}

// POST /clientes/registrar  (continua criando como CLIENTE)
router.post("/registrar", async (req, res) => {
  const validacao = clienteSchema.safeParse(req.body)
  if (!validacao.success) {
    return res
      .status(400)
      .json({ erro: validacao.error.errors.map((e) => e.message).join("; ") })
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
        tipo: TipoUsuario.CLIENTE,
        verificado: false,
        codigoEmail: codigo,
      },
    })

    try {
      await enviarCodigoEmail(email, codigo)
    } catch (e) {
      await prisma.usuario.delete({ where: { id: novo.id } })
      return res.status(500).json({ erro: "Erro ao enviar email de verificação" })
    }

    res
      .status(201)
      .json({ mensagem: "Código enviado. Verifique seu e-mail para validar." })
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({ erro: error })
    }
    console.log(error)
    res.status(500).json({ erro: error })
  }
})

// POST /clientes/validar-email (checa só clientes)
router.post("/validar-email", async (req, res) => {
  const { email, codigo } = req.body

  if (!email || !codigo) {
    return res.status(400).json({ erro: "E-mail e código são obrigatórios" })
  }

  try {
    const cliente = await prisma.usuario.findFirst({
      where: { email, tipo: TipoUsuario.CLIENTE },
    })

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

/**
 * GET /clientes
 * Agora retorna TODOS os usuários (CLIENTE e ADMIN_*), com autocomplete por ?nome=.
 * Extra (opcional): você pode filtrar por tipos passando ?tipos=CLIENTE,ADMIN_MASTER,...
 */
router.get("/", async (req, res) => {
  try {
    const { nome, tipos } = req.query as { nome?: string; tipos?: string }

    // filtro por nome (autocomplete)
    const whereNome = nome
      ? { nome: { contains: String(nome), mode: "insensitive" as const } }
      : {}

    // filtro opcional por tipos (lista separada por vírgula)
    let whereTipos = {}
    if (tipos) {
      const lista = tipos
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as (keyof typeof TipoUsuario)[]
      if (lista.length) {
        whereTipos = {
          tipo: { in: lista as unknown as TipoUsuario[] },
        }
      }
    }

    const query: any = {
      where: { ...whereNome, ...whereTipos },
      orderBy: { nome: "asc" },
      ...(nome ? { take: 10 } : {}), // limita quando é autocomplete
    }

    const usuarios = await prisma.usuario.findMany(query)
    res.json(usuarios)
  } catch (error) {
    console.error(error)
    res.status(500).json({ erro: "Erro ao buscar usuários" })
  }
})

/**
 * GET /clientes/:id
 * Busca por ID em qualquer tipo de usuário
 */
router.get("/:id", async (req, res) => {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id },
    })

    if (!usuario) return res.status(404).json({ erro: "Usuário não encontrado" })
    res.json(usuario)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar usuário" })
  }
})

// DELETE /clientes/:id
router.delete("/:id", async (req, res) => {
  try {
    await prisma.usuario.delete({ where: { id: req.params.id } })
    res.json({ mensagem: "Usuário excluído com sucesso" })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao excluir usuário" })
  }
})

export default router
