package com.synapsedesk.gateway.modules.realtime;

/** `NewAttachmentDto` — an already-uploaded object, bound as the message is created. */
public record NewAttachmentBody(String objectPath, String fileName) {}
