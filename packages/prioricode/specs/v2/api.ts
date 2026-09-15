// @ts-nocheck

import { PrioriCode } from "@prioricode/core"
import { ReadTool } from "@prioricode/core/tools"

const prioricode = PrioriCode.make({})

prioricode.tool.add(ReadTool)

prioricode.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

prioricode.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

prioricode.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await prioricode.session.create({
  agent: "build",
})

prioricode.subscribe((event) => {
  console.log(event)
})

await prioricode.session.prompt({
  sessionID,
  text: "hey what is up",
})

await prioricode.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await prioricode.session.wait()

console.log(await prioricode.session.messages(sessionID))
