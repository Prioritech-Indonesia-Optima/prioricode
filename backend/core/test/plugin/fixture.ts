import { Agent } from "@prioricode/core/agent"
import { AISDK } from "@prioricode/core/aisdk"
import { Catalog } from "@prioricode/core/catalog"
import { Command } from "@prioricode/core/command"
import { Credential } from "@prioricode/core/credential"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@prioricode/core/effect/app-node-platform"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventBus } from "@prioricode/core/event"
import { FileSystem } from "@prioricode/core/filesystem"
import { FSUtil } from "@prioricode/core/fs-util"
import { Integration } from "@prioricode/core/integration"
import { Location } from "@prioricode/core/location"
import { Npm } from "@prioricode/core/npm"
import { Plugin } from "@prioricode/core/plugin"
import { Reference } from "@prioricode/core/reference"
import { Skill } from "@prioricode/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventBus.node,
    LayerNodePlatform.httpClient,
    Plugin.node,
    Agent.node,
    AISDK.node,
    Catalog.node,
    Command.node,
    Integration.node,
    Reference.node,
    Skill.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
