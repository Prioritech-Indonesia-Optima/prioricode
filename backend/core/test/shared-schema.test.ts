import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "@prioricode/schema/agent"
import { Location } from "@prioricode/schema/location"
import { Model } from "@prioricode/schema/model"
import { AgentAttachment, FileAttachment, Prompt, Source } from "@prioricode/schema/prompt"
import { Provider } from "@prioricode/schema/provider"
import { Project } from "@prioricode/schema/project"
import { ProjectDirectories } from "@prioricode/schema/project-directories"
import { PermissionV1 } from "@prioricode/schema/permission-v1"
import { Session } from "@prioricode/schema/session"
import { SessionInput } from "@prioricode/schema/session-input"
import { SessionMessage } from "@prioricode/schema/session-message"
import { Workspace } from "@prioricode/schema/workspace"
import { Command } from "@prioricode/schema/command"
import { Connection } from "@prioricode/schema/connection"
import { Credential } from "@prioricode/schema/credential"
import { FileSystem } from "@prioricode/schema/filesystem"
import { Integration } from "@prioricode/schema/integration"
import { LLM } from "@prioricode/schema/llm"
import { Permission } from "@prioricode/schema/permission"
import { Plugin } from "@prioricode/schema/plugin"
import { Pty } from "@prioricode/schema/pty"
import { Reference } from "@prioricode/schema/reference"
import { SessionTodo } from "@prioricode/schema/session-todo"
import { Skill } from "@prioricode/schema/skill"
import { AbsolutePath, optional, statics } from "@prioricode/schema/schema"

test("Core reuses the canonical shared schemas", async () => {
  const [
    coreCommand,
    coreConnection,
    coreCredential,
    coreFileSystem,
    coreIntegration,
    coreLocation,
    coreLLM,
    corePermission,
    corePermissionV1,
    coreProjectCopy,
    corePty,
    coreProject,
    coreReference,
    coreSessionInput,
    coreSessionMessage,
    coreSessionTodo,
    corePrompt,
    coreSkill,
    coreSchema,
    coreWorkspace,
  ] = await Promise.all([
    import("@prioricode/core/command"),
    import("@prioricode/core/integration/connection"),
    import("@prioricode/core/credential"),
    import("@prioricode/core/filesystem"),
    import("@prioricode/core/integration"),
    import("@prioricode/core/location"),
    import("@prioricode/llm"),
    import("@prioricode/core/permission"),
    import("@prioricode/core/v1/permission"),
    import("@prioricode/core/project/copy"),
    import("@prioricode/core/pty"),
    import("@prioricode/core/project/schema"),
    import("@prioricode/core/reference"),
    import("@prioricode/core/session/input"),
    import("@prioricode/core/session/message"),
    import("@prioricode/core/session/todo"),
    import("@prioricode/core/session/prompt"),
    import("@prioricode/core/skill"),
    import("@prioricode/core/schema"),
    import("@prioricode/core/workspace"),
  ])

  const schemas = [
    [Agent.ID, Agent.ID],
    [Agent.Color, Agent.Color],
    [Agent.Info, Agent.Info],
    [coreCommand.Info, Command.Info],
    [coreConnection.CredentialInfo, Connection.CredentialInfo],
    [coreConnection.EnvInfo, Connection.EnvInfo],
    [coreConnection.Info, Connection.Info],
    [coreCredential.ID, Credential.ID],
    [coreCredential.OAuth, Credential.OAuth],
    [coreCredential.Key, Credential.Key],
    [coreCredential.Value, Credential.Value],
    [coreFileSystem.Entry, FileSystem.Entry],
    [coreFileSystem.Submatch, FileSystem.Submatch],
    [coreFileSystem.Match, FileSystem.Match],
    [coreIntegration.ID, Integration.ID],
    [coreIntegration.MethodID, Integration.MethodID],
    [coreIntegration.When, Integration.When],
    [coreIntegration.TextPrompt, Integration.TextPrompt],
    [coreIntegration.SelectPrompt, Integration.SelectPrompt],
    [coreIntegration.Prompt, Integration.Prompt],
    [coreIntegration.OAuthMethod, Integration.OAuthMethod],
    [coreIntegration.KeyMethod, Integration.KeyMethod],
    [coreIntegration.EnvMethod, Integration.EnvMethod],
    [coreIntegration.Method, Integration.Method],
    [coreIntegration.Inputs, Integration.Inputs],
    [coreIntegration.Ref, Integration.Ref],
    [coreLocation.Ref, Location.Ref],
    [coreLLM.ProviderMetadata, LLM.ProviderMetadata],
    [coreLLM.ToolTextContent, LLM.ToolTextContent],
    [coreLLM.ToolFileContent, LLM.ToolFileContent],
    [coreLLM.ToolContent, LLM.ToolContent],
    [Model.ID, Model.ID],
    [Model.VariantID, Model.VariantID],
    [Model.Ref, Model.Ref],
    [Model.Family, Model.Family],
    [Model.Capabilities, Model.Capabilities],
    [Model.Cost, Model.Cost],
    [Model.Api, Model.Api],
    [Model.Info, Model.Info],
    [Provider.ID, Provider.ID],
    [Provider.AISDK, Provider.AISDK],
    [Provider.Native, Provider.Native],
    [Provider.Api, Provider.Api],
    [Provider.Request, Provider.Request],
    [Provider.Info, Provider.Info],
    [corePermission.Effect, Permission.Effect],
    [corePermission.Rule, Permission.Rule],
    [corePermission.Ruleset, Permission.Ruleset],
    [corePermissionV1.Event, PermissionV1.Event],
    [coreProjectCopy.Event, ProjectDirectories.Event],
    [Plugin.ID, Plugin.ID],
    [Plugin.Event, Plugin.Event],
    [corePty.Info, Pty.Info],
    [corePty.Event, Pty.Event],
    [coreProject.ID, Project.ID],
    [coreReference.LocalSource, Reference.LocalSource],
    [coreReference.GitSource, Reference.GitSource],
    [coreReference.Source, Reference.Source],
    [Session.ID, Session.ID],
    [Session.Info, Session.Info],
    [Session.ListAnchor, Session.ListAnchor],
    [coreSessionInput.Delivery, SessionInput.Delivery],
    [coreSessionInput.Admitted, SessionInput.Admitted],
    [coreSessionMessage.ID, SessionMessage.ID],
    [coreSessionMessage.UnknownError, SessionMessage.UnknownError],
    [coreSessionMessage.AgentSwitched, SessionMessage.AgentSwitched],
    [coreSessionMessage.ModelSwitched, SessionMessage.ModelSwitched],
    [coreSessionMessage.User, SessionMessage.User],
    [coreSessionMessage.Synthetic, SessionMessage.Synthetic],
    [coreSessionMessage.System, SessionMessage.System],
    [coreSessionMessage.Shell, SessionMessage.Shell],
    [coreSessionMessage.ToolStatePending, SessionMessage.ToolStatePending],
    [coreSessionMessage.ToolStateRunning, SessionMessage.ToolStateRunning],
    [coreSessionMessage.ToolStateCompleted, SessionMessage.ToolStateCompleted],
    [coreSessionMessage.ToolStateError, SessionMessage.ToolStateError],
    [coreSessionMessage.ToolState, SessionMessage.ToolState],
    [coreSessionMessage.AssistantTool, SessionMessage.AssistantTool],
    [coreSessionMessage.AssistantText, SessionMessage.AssistantText],
    [coreSessionMessage.AssistantReasoning, SessionMessage.AssistantReasoning],
    [coreSessionMessage.AssistantContent, SessionMessage.AssistantContent],
    [coreSessionMessage.Assistant, SessionMessage.Assistant],
    [coreSessionMessage.Compaction, SessionMessage.Compaction],
    [coreSessionMessage.Message, SessionMessage.Message],
    [coreSessionTodo.Info, SessionTodo.Info],
    [coreSessionTodo.Event, SessionTodo.Event],
    [corePrompt.Source, Source],
    [corePrompt.FileAttachment, FileAttachment],
    [corePrompt.AgentAttachment, AgentAttachment],
    [corePrompt.Prompt, Prompt],
    [coreSkill.DirectorySource, Skill.DirectorySource],
    [coreSkill.UrlSource, Skill.UrlSource],
    [coreSkill.EmbeddedSource, Skill.EmbeddedSource],
    [coreSkill.Source, Skill.Source],
    [coreSkill.Info, Skill.Info],
    [coreSchema.optional, optional],
    [coreSchema.statics, statics],
    [coreWorkspace.ID, Workspace.ID],
  ]
  for (const [core, shared] of schemas) expect(core).toBe(shared)

  expect(Agent.Info.empty(Agent.ID.make("test"))).toEqual(Agent.Info.empty(Agent.ID.make("test")))
  expect(Model.Info.empty(Provider.ID.make("test"), Model.ID.make("model"))).toEqual(
    Model.Info.empty(Provider.ID.make("test"), Model.ID.make("model")),
  )
  expect(Provider.Info.empty(Provider.ID.make("test"))).toEqual(Provider.Info.empty(Provider.ID.make("test")))
  expect(Skill.Source.key(Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make("/tmp") }))).toBe(
    "directory:/tmp",
  )
})

test("shared record schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", id: "part_1", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
  expect(Prompt.equivalence(Prompt.make({ text: "hello" }), decoded)).toBe(true)
  expect(Prompt.fromUserMessage({ text: "hello" })).toEqual(made)
  expect(Workspace.ID.ascending("")).toStartWith("wrk_")
})
