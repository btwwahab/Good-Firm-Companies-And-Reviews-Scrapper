<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('companies', function (Blueprint $table) {
            $table->id();
            $table->string('name')->index();
            $table->string('profile')->nullable();
            $table->string('website')->nullable();
            $table->string('image')->nullable();
            $table->string('source')->nullable();
            $table->timestamp('scraped_at')->nullable();
            $table->timestamps();
            $table->unique(['name', 'source']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('companies');
    }
};
