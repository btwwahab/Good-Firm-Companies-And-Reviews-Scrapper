<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('goodfirm_companies', function (Blueprint $table) {
            $table->id();
            $table->string('profile')->nullable();
            $table->tinyInteger('detail')->default(0)->comment('Detail flag: 0 or 1');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('goodfirm_companies');
    }
};
