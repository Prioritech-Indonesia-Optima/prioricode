export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@prioricode/schema/event"
import { EventManifest } from "@prioricode/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
