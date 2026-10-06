import { AgentV2 } from "@prioricode/core/agent"
import { AISDK } from "@prioricode/core/aisdk"
import { Catalog } from "@prioricode/core/catalog"
import { CommandV2 } from "@prioricode/core/command"
import { Credential } from "@prioricode/core/credential"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@prioricode/core/effect/app-node-platform"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventV2 } from "@prioricode/core/event"
import { FileSystem } from "@prioricode/core/filesystem"
import { FSUtil } from "@prioricode/core/fs-util"
import { Integration } from "@prioricode/core/integration"
import { Location } from "@prioricode/core/location"
import { Npm } from "@prioricode/core/npm"
import { PluginV2 } from "@prioricode/core/plugin"
import { Reference } from "@prioricode/core/reference"
import { SkillV2 } from "@prioricode/core/skill"
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
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
