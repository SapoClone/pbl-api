import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { EventHandler, ON_EVENT_METADATA } from './on-event.decorator';

/** Finds the `@OnEvent` methods of the app's providers at startup */
@Injectable()
export class EventHandlerRegistry implements OnModuleInit {
  private readonly handlers = new Map<string, EventHandler[]>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;
      const prototype = Object.getPrototypeOf(instance);
      if (!prototype) continue;
      for (const method of this.scanner.getAllMethodNames(prototype)) {
        const type = this.reflector.get<string>(
          ON_EVENT_METADATA,
          instance[method],
        );
        if (type) this.register(type, instance[method].bind(instance));
      }
    }
  }

  register(type: string, handler: EventHandler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  handlersFor(type: string): EventHandler[] {
    return this.handlers.get(type) ?? [];
  }

  get size(): number {
    return this.handlers.size;
  }
}
